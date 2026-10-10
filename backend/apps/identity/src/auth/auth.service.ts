import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef } from '../../../../packages/technical/src/idempotency';
import { hashPurposeBoundSecret } from '../../../../packages/technical/src/secret-hash';
import { LoginDto, RegisterDto, ChangePasswordDto } from './auth.dto';
import { IDENTITY_AUTH_CONFIG, AuthContext } from './auth.guard';
import { IdentityAuthConfig, assertStrongPassword, issueAccessToken, WindowRateLimiter } from './auth-security';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  status: string;
  must_change_password: boolean;
  authz_version: number;
}

interface FamilyRow {
  id: string;
  user_id: string;
  client_kind: 'WEB' | 'NATIVE';
  authz_version: number;
  absolute_expires_at: Date;
  must_change_password: boolean;
  rotated_at?: Date | null;
  user_status?: string;
  user_authz_version?: number;
  revoked_at?: Date | null;
}

export interface IssuedSession {
  user: { id: string; username: string; display_name: string };
  clientKind: 'WEB' | 'NATIVE';
  familyId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  absoluteExpiresAt: Date;
  mustChangePassword: boolean;
}

interface RefreshFailure {
  error: 'SESSION_EXPIRED' | 'REFRESH_RACE' | 'REFRESH_REUSED';
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash = '';
  private readonly rateLimiter = new WindowRateLimiter();
  private activeArgonOperations = 0;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyPasswordHash = await this.hashPassword(randomBytes(32).toString('base64url'));
  }

  async register(dto: RegisterDto, idempotencyKey: string, ip: string): Promise<IdempotentResult<{ user: { id: string; username: string; display_name: string } }>> {
    this.consumeRate(`register:${ip}`, 3, 60 * 60_000);
    if (!dto.display_name.trim() || dto.display_name !== dto.display_name.normalize('NFC')) {
      throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { display_name: ['VALIDATION_FAILED'] } });
    }
    assertStrongPassword(dto.password, dto.username);
    const passwordHash = await this.hashPassword(dto.password);
    const passwordBinding = hashPurposeBoundSecret(dto.password, 'identity-register-idempotency', this.config.refreshPeppers, this.config.currentRefreshPepperVersion);
    const result = await this.idempotency.execute<{ user: { id: string; username: string; display_name: string } }>(this.dataSource, {
      scopeKey: 'anon:register',
      command: 'identity.auth.register',
      key: idempotencyKey,
      requestHash: canonicalRequestHash({ username: dto.username, display_name: dto.display_name, password_binding: passwordBinding }),
      databaseErrorMappings: { unique: { app_user_username_key: 'USERNAME_TAKEN' } },
      execute: async (manager) => {
        const rows = await manager.query(
          'INSERT INTO app_user (username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, username, display_name',
          [dto.username, dto.display_name, passwordHash],
        ) as Array<{ id: string; username: string; display_name: string }>;
        const user = rows[0];
        if (!user) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await manager.query("INSERT INTO role_grant (user_id, role_code, scope_type) VALUES ($1, 'CITIZEN', 'SYSTEM')", [user.id]);
        return { status: 201, value: { user }, resource: { type: 'app_user', id: user.id } };
      },
      replay: async (manager, resource) => ({ user: await this.readRegisteredUser(manager, resource) }),
    });
    return result;
  }

  async login(dto: LoginDto, ip: string): Promise<IssuedSession> {
    const username = dto.username.toLowerCase();
    this.consumeRate(`login-user:${ip}:${username}`, 5, 60_000);
    this.consumeRate(`login-ip:${ip}`, 30, 60_000);
    this.consumeRate('login-global', 300, 60_000);
    const users = await this.dataSource.query(
      'SELECT id, username, display_name, password_hash, status, must_change_password, authz_version FROM app_user WHERE username = $1',
      [dto.username],
    ) as UserRow[];
    const user = users[0];
    const candidateHash = user?.status === 'ACTIVE' ? user.password_hash : this.dummyPasswordHash;
    const validPassword = await this.verifyPassword(candidateHash, dto.password);
    if (!user || user.status !== 'ACTIVE' || !validPassword) throw new AppError('INVALID_CREDENTIALS', { status: 401 });

    const familyId = randomUUID();
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshHash = this.refreshHash(refreshToken);
    const family = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.query(
        'SELECT status, password_hash, authz_version FROM app_user WHERE id = $1 FOR SHARE',
        [user.id],
      ) as Array<{ status: string; password_hash: string; authz_version: number }>;
      const latest = locked[0];
      if (!latest || latest.status !== 'ACTIVE' || latest.password_hash !== user.password_hash || Number(latest.authz_version) !== Number(user.authz_version)) return undefined;
      const families = await manager.query(
        "INSERT INTO session_family (id, user_id, client_kind, authz_version, absolute_expires_at) VALUES ($1, $2, $3, $4, now() + interval '7 days') RETURNING absolute_expires_at",
        [familyId, user.id, dto.client_kind, user.authz_version],
      ) as Array<{ absolute_expires_at: Date }>;
      if (!families[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
      await manager.query('INSERT INTO refresh_session (token_hash, family_id) VALUES ($1, $2)', [refreshHash, familyId]);
      return families[0].absolute_expires_at;
    });
    if (!family) throw new AppError('INVALID_CREDENTIALS', { status: 401 });
    return this.issueSession(user, familyId, dto.client_kind, refreshToken, family);
  }

  async refresh(rawToken: string | undefined, clientKind: 'WEB' | 'NATIVE'): Promise<IssuedSession> {
    if (!rawToken || !/^[A-Za-z0-9_-]{43}$/.test(rawToken) || Buffer.from(rawToken, 'base64url').length !== 32) {
      throw new AppError('SESSION_EXPIRED', { status: 401 });
    }
    const tokenHash = this.refreshHash(rawToken);
    const nextToken = randomBytes(32).toString('base64url');
    const nextHash = this.refreshHash(nextToken);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const found = await manager.query('SELECT family_id FROM refresh_session WHERE token_hash = $1', [tokenHash]) as Array<{ family_id: string }>;
      const familyId = found[0]?.family_id;
      if (!familyId) return { error: 'SESSION_EXPIRED' } satisfies RefreshFailure;

      const accounts = await manager.query(
        `SELECT sf.id, sf.user_id, sf.authz_version, sf.revoked_at, u.status AS user_status,
                u.authz_version AS user_authz_version, u.must_change_password,
                u.username, u.display_name
           FROM session_family sf JOIN app_user u ON u.id = sf.user_id
          WHERE sf.id = $1 FOR SHARE OF u`,
        [familyId],
      ) as Array<FamilyRow & { username: string; display_name: string }>;
      const account = accounts[0];
      if (!account) return { error: 'SESSION_EXPIRED' } satisfies RefreshFailure;
      if (account.user_status !== 'ACTIVE' || Number(account.authz_version) !== Number(account.user_authz_version)) {
        if (!account.revoked_at) {
          await manager.query('UPDATE session_family SET revoked_at = now(), revoke_reason = $2 WHERE id = $1 AND revoked_at IS NULL', [familyId, account.user_status === 'ACTIVE' ? 'ROLE_CHANGE' : 'DISABLED']);
        }
        return { error: 'SESSION_EXPIRED' } satisfies RefreshFailure;
      }

      const families = await manager.query(
        'SELECT id, user_id, client_kind, authz_version, absolute_expires_at, revoked_at FROM session_family WHERE id = $1 FOR UPDATE',
        [familyId],
      ) as FamilyRow[];
      const family = families[0];
      if (!family || family.revoked_at || new Date(family.absolute_expires_at).getTime() <= Date.now() || family.client_kind !== clientKind) {
        return { error: 'SESSION_EXPIRED' } satisfies RefreshFailure;
      }
      const refreshRows = await manager.query(
        'SELECT family_id, rotated_at FROM refresh_session WHERE token_hash = $1 FOR UPDATE',
        [tokenHash],
      ) as Array<{ family_id: string; rotated_at: Date | null }>;
      const refreshSession = refreshRows[0];
      if (!refreshSession || refreshSession.family_id !== family.id) return { error: 'SESSION_EXPIRED' } satisfies RefreshFailure;
      if (refreshSession.rotated_at) {
        if (Date.now() - new Date(refreshSession.rotated_at).getTime() < 10_000) return { error: 'REFRESH_RACE' } satisfies RefreshFailure;
        await manager.query(
          "UPDATE session_family SET revoked_at = now(), revoke_reason = 'REUSE_DETECTED' WHERE id = $1 AND revoked_at IS NULL",
          [family.id],
        );
        return { error: 'REFRESH_REUSED' } satisfies RefreshFailure;
      }

      const rotated = (await manager.query(
        'UPDATE refresh_session SET rotated_at = now() WHERE token_hash = $1 AND rotated_at IS NULL RETURNING token_hash',
        [tokenHash],
      ))[0] as Array<{ token_hash: string }>;
      if (rotated.length !== 1) return { error: 'REFRESH_RACE' } satisfies RefreshFailure;
      await manager.query('INSERT INTO refresh_session (token_hash, family_id) VALUES ($1, $2)', [nextHash, family.id]);
      return {
        session: {
          ...family,
          must_change_password: account.must_change_password,
          user_status: account.user_status,
          username: account.username,
          display_name: account.display_name,
          rotated_at: refreshSession.rotated_at,
        },
      };
    });

    if ('error' in outcome) {
      const status = outcome.error === 'REFRESH_RACE' ? 409 : 401;
      throw new AppError(outcome.error, { status });
    }
    const session = outcome.session;
    const user: UserRow = {
      id: session.user_id,
      username: session.username,
      display_name: session.display_name,
      password_hash: '',
      status: session.user_status ?? 'ACTIVE',
      must_change_password: session.must_change_password,
      authz_version: session.authz_version,
    };
    return this.issueSession(user, session.id, clientKind, nextToken, session.absolute_expires_at);
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.dataSource.query(
      "UPDATE session_family SET revoked_at = now(), revoke_reason = 'LOGOUT' WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
      [auth.sessionId, auth.userId],
    );
  }

  async changePassword(auth: AuthContext, dto: ChangePasswordDto, idempotencyKey: string): Promise<void> {
    const users = await this.dataSource.query(
      'SELECT username, password_hash, status FROM app_user WHERE id = $1',
      [auth.userId],
    ) as Array<{ username: string; password_hash: string; status: string }>;
    const user = users[0];
    assertStrongPassword(dto.new_password, user?.username ?? '');
    if (dto.new_password === dto.current_password) throw new AppError('PASSWORD_WEAK', { status: 400 });
    const candidateHash = user?.status === 'ACTIVE' ? user.password_hash : this.dummyPasswordHash;
    const currentPasswordValid = await this.verifyPassword(candidateHash, dto.current_password);
    const nextPasswordHash = await this.hashPassword(dto.new_password);
    const currentBinding = hashPurposeBoundSecret(dto.current_password, 'identity-password-change-current', this.config.refreshPeppers, this.config.currentRefreshPepperVersion);
    const nextBinding = hashPurposeBoundSecret(dto.new_password, 'identity-password-change-next', this.config.refreshPeppers, this.config.currentRefreshPepperVersion);

    await this.idempotency.execute<void>(this.dataSource, {
      scopeKey: `user:${auth.userId}`,
      command: 'identity.auth.change-password',
      key: idempotencyKey,
      requestHash: canonicalRequestHash({ current_password_binding: currentBinding, new_password_binding: nextBinding }),
      execute: async (manager: EntityManager) => {
        if (!user || user.status !== 'ACTIVE' || !currentPasswordValid) throw new AppError('INVALID_CREDENTIALS', { status: 401 });
        const updated = (await manager.query(
          `UPDATE app_user
              SET password_hash = $3, must_change_password = false,
                  authz_version = authz_version + 1, version = version + 1
            WHERE id = $1 AND password_hash = $2 AND status = 'ACTIVE'
            RETURNING authz_version`,
          [auth.userId, user.password_hash, nextPasswordHash],
        ))[0] as Array<{ authz_version: number }>;
        if (!updated[0]) throw new AppError('INVALID_CREDENTIALS', { status: 401 });
        await manager.query(
          "UPDATE session_family SET revoked_at = now(), revoke_reason = 'PASSWORD_CHANGE' WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
          [auth.userId, auth.sessionId],
        );
        const family = (await manager.query(
          'UPDATE session_family SET authz_version = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
          [auth.sessionId, auth.userId, updated[0].authz_version],
        ))[0] as Array<{ id: string }>;
        if (family.length !== 1) throw new AppError('SESSION_EXPIRED', { status: 401 });
        return { status: 204, value: undefined, resource: null };
      },
      replay: async () => undefined,
    });
  }

  async me(userId: string): Promise<Record<string, unknown>> {
    const users = await this.dataSource.query(
      'SELECT id, username, display_name, must_change_password FROM app_user WHERE id = $1 AND status = \'ACTIVE\'',
      [userId],
    ) as Array<{ id: string; username: string; display_name: string; must_change_password: boolean }>;
    const user = users[0];
    if (!user) throw new AppError('SESSION_EXPIRED', { status: 401 });
    const grants = await this.dataSource.query(
      `SELECT id, role_code, scope_type, organization_id, region_code, campaign_id
         FROM role_grant WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY created_at, id`,
      [userId],
    ) as Array<Record<string, unknown>>;
    return { ...user, grants };
  }

  async hashTemporaryPassword(password: string, username: string): Promise<string> {
    assertStrongPassword(password, username);
    return this.hashPassword(password);
  }

  private async readRegisteredUser(manager: EntityManager, resource: ResourceRef | null): Promise<{ id: string; username: string; display_name: string }> {
    if (!resource || resource.type !== 'app_user') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query('SELECT id, username, display_name FROM app_user WHERE id = $1', [resource.id]) as Array<{ id: string; username: string; display_name: string }>;
    if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
    return rows[0];
  }

  private issueSession(user: UserRow, familyId: string, clientKind: 'WEB' | 'NATIVE', refreshToken: string, absoluteExpiresAt: Date): IssuedSession {
    const accessToken = issueAccessToken(this.config, { userId: user.id, familyId, absoluteExpiresAt });
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const accessExpiresIn = Math.max(0, Math.min(600, Math.floor(absoluteExpiresAt.getTime() / 1_000) - nowSeconds));
    return {
      user: { id: user.id, username: user.username, display_name: user.display_name },
      clientKind,
      familyId,
      accessToken,
      refreshToken,
      accessExpiresIn,
      absoluteExpiresAt,
      mustChangePassword: user.must_change_password,
    };
  }

  private refreshHash(token: string): string {
    return hashPurposeBoundSecret(token, 'identity-refresh-session', this.config.refreshPeppers, this.config.currentRefreshPepperVersion);
  }

  private consumeRate(key: string, limit: number, windowMs: number): void {
    const retryAfterSeconds = this.rateLimiter.consume(key, limit, windowMs);
    if (retryAfterSeconds > 0) throw new AppError('RATE_LIMITED', { status: 429, retryAfterSeconds });
  }

  private async hashPassword(password: string): Promise<string> {
    return this.runArgon(() => argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.argonMemoryKib,
      timeCost: this.config.argonTimeCost,
      parallelism: this.config.argonParallelism,
    }));
  }

  private async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    return this.runArgon(async () => {
      try { return await argon2.verify(passwordHash, password); } catch { return false; }
    });
  }

  private async runArgon<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeArgonOperations >= this.config.argonMaxConcurrency) {
      throw new AppError('RATE_LIMITED', { status: 429, retryAfterSeconds: 1 });
    }
    this.activeArgonOperations++;
    try { return await work(); } finally { this.activeArgonOperations--; }
  }
}
