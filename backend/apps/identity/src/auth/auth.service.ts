import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import argon2 from 'argon2';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { JobRunner } from '@c48/technical/persistence/jobs';
import { withDatabaseRetry } from '@c48/technical/persistence/postgres-errors';
import { hashPurposeBoundSecret } from '@c48/technical/security/secret-hash';
import { LoginDto, RegisterDto, ChangePasswordDto, GoogleLoginDto } from './auth.dto';
import { IDENTITY_AUTH_CONFIG, AuthContext } from './auth.guard';
import { IdentityAuthConfig, assertStrongPassword, issueAccessToken, WindowRateLimiter } from './auth-security';
import { EmailSenderService } from './email-sender.service';

interface EmailRegistrationRow {
  id: string;
  challenge_id: string;
  username: string;
  display_name: string;
  email: string;
  password_hash: string | null;
  code_hash: string | null;
  attempts: number;
  expires_at: Date | string;
  code_expires_at: Date | string;
  last_sent_at: Date | string;
  confirmed_at: Date | string | null;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string | null;
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
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private readonly jobs: JobRunner;
  private stopCleanup?: () => void;
  private dummyPasswordHash = '';
  private readonly rateLimiter = new WindowRateLimiter();
  private activeArgonOperations = 0;
  private readonly googleClient = new OAuth2Client();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
    @Optional() private readonly emailSender?: EmailSenderService,
  ) {
    this.jobs = new JobRunner(dataSource, () => this.logger.warn('SCHEDULED_JOB_FAILED identity.email-registration.cleanup'));
  }

  async onModuleInit(): Promise<void> {
    this.dummyPasswordHash = await this.hashPassword(randomBytes(32).toString('base64url'));
    this.stopCleanup = this.jobs.schedule('identity.email-registration.cleanup', 60_000, async (manager) => {
      await manager.query(`WITH expired AS (
        SELECT id FROM email_registration WHERE expires_at<=clock_timestamp()
        ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
      ) DELETE FROM email_registration r USING expired WHERE r.id=expired.id`);
    });
  }

  onModuleDestroy(): void { this.stopCleanup?.(); }

  async register(dto: RegisterDto, idempotencyKey: string, ip: string): Promise<IdempotentResult<{ user: { id: string; username: string; display_name: string }; verification: { challenge_id: string }; email_sent: boolean }>> {
    this.consumeRate(`register:${ip}`, 3, 60 * 60_000);
    if (!this.config.emailOtpPepper) throw new AppError('EMAIL_OTP_UNAVAILABLE', { status: 503 });
    if (!dto.display_name.trim() || dto.display_name !== dto.display_name.normalize('NFC')) {
      throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { display_name: ['VALIDATION_FAILED'] } });
    }
    assertStrongPassword(dto.password, dto.username);
    const email = dto.email.trim().normalize('NFC').toLowerCase();
    this.consumeRate(`register-email:${email}`, 3, 60 * 60_000);
    const passwordHash = await this.hashPassword(dto.password);
    const registrationId = randomUUID();
    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const passwordBinding = hashPurposeBoundSecret(dto.password, 'identity-register-idempotency', this.config.refreshPeppers, this.config.currentRefreshPepperVersion);
    const result = await this.idempotency.execute<{ user: { id: string; username: string; display_name: string }; verification: { challenge_id: string }; email_sent: boolean }>(this.dataSource, {
      scopeKey: 'anon:register', command: 'identity.auth.register', key: idempotencyKey,
      requestHash: canonicalRequestHash({ username: dto.username, display_name: dto.display_name, email, password_binding: passwordBinding }),
      execute: async (manager) => {
        const owners = await manager.query('SELECT username,email FROM app_user WHERE username=$1 OR lower(email)=$2', [dto.username, email]) as Array<{ username: string; email: string | null }>;
        if (owners.some((owner) => owner.username.toLowerCase() === dto.username.toLowerCase())) throw new AppError('USERNAME_TAKEN', { status: 409 });
        if (owners.length) throw new AppError('EMAIL_TAKEN', { status: 409 });
        const rows = await manager.query(
          `INSERT INTO email_registration (id,challenge_id,username,display_name,email,password_hash,code_hash,expires_at,code_expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes',now()+interval '5 minutes')
           RETURNING id,username,display_name`,
          [registrationId, challengeId, dto.username, dto.display_name, email, passwordHash, this.emailOtpHash(challengeId, code)],
        ) as Array<{ id: string; username: string; display_name: string }>;
        if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return { status: 201, value: { user: rows[0], verification: { challenge_id: challengeId }, email_sent: false }, resource: { type: 'email_registration', id: registrationId } };
      },
      replay: async (manager, resource) => {
        // Old keys point at legacy account placeholders; never recreate or disclose them.
        if (resource?.type !== 'email_registration') throw new AppError('REGISTRATION_EXPIRED', { status: 410 });
        const rows = await manager.query('SELECT id,username,display_name,challenge_id,expires_at FROM email_registration WHERE id=$1', [resource.id]) as EmailRegistrationRow[];
        const row = rows[0];
        if (!row || new Date(row.expires_at).getTime() <= Date.now()) throw new AppError('REGISTRATION_EXPIRED', { status: 410 });
        return { user: { id: row.id, username: row.username, display_name: row.display_name }, verification: { challenge_id: row.challenge_id }, email_sent: false };
      },
    });
    if (result.replay) return result;
    const emailSent = await this.emailSender?.sendVerificationCode(email, code) ?? false;
    return { ...result, value: { ...result.value, email_sent: emailSent } };
  }

  async verifyEmail(challengeId: string, code: string, ip: string): Promise<{ verified: true; user: { id: string; username: string; display_name: string } }> {
    this.consumeRate(`email-otp-verify:${ip}`, 10, 60_000);
    if (!this.config.emailOtpPepper) throw new AppError('EMAIL_OTP_UNAVAILABLE', { status: 503 });
    const result = await withDatabaseRetry(() => this.dataSource.transaction(async (manager) => {
      const rows = await manager.query('SELECT * FROM email_registration WHERE challenge_id=$1 FOR UPDATE', [challengeId]) as EmailRegistrationRow[];
      const row = rows[0];
      if (!row) return undefined;
      if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
      if (row.confirmed_at || !row.code_hash || !row.password_hash || Number(row.attempts) >= 5 || new Date(row.code_expires_at).getTime() <= Date.now()) return undefined;
      const actual = Buffer.from(this.emailOtpHash(challengeId, code));
      const expected = Buffer.from(row.code_hash);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        await manager.query('UPDATE email_registration SET attempts=attempts+1 WHERE id=$1', [row.id]);
        return undefined;
      }
      const users = await manager.query(
        `INSERT INTO app_user (id,username,display_name,email,password_hash,status,email_verified_at)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE',now()) RETURNING id,username,display_name`,
        [row.id, row.username, row.display_name, row.email, row.password_hash],
      ) as Array<{ id: string; username: string; display_name: string }>;
      if (!users[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
      await manager.query("INSERT INTO role_grant (user_id,role_code,scope_type) VALUES ($1,'CITIZEN','SYSTEM')", [row.id]);
      await manager.query('UPDATE email_registration SET confirmed_at=now(),password_hash=NULL,code_hash=NULL WHERE id=$1', [row.id]);
      return users[0];
    }), { mappings: { unique: { app_user_username_key: 'USERNAME_TAKEN', app_user_email_lower_uq: 'EMAIL_TAKEN' } } });
    if (!result) throw new AppError('EMAIL_OTP_INVALID', { status: 400 });
    return { verified: true, user: result };
  }

  async resendEmailOtp(challengeId: string, ip: string): Promise<{ challenge_id: string | null; email_sent: boolean }> {
    this.consumeRate(`email-otp-resend:${ip}`, 3, 60 * 60_000);
    if (!this.config.emailOtpPepper) throw new AppError('EMAIL_OTP_UNAVAILABLE', { status: 503 });
    const nextId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const outcome = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query('SELECT * FROM email_registration WHERE challenge_id=$1 FOR UPDATE', [challengeId]) as EmailRegistrationRow[];
      const row = rows[0];
      if (!row) return undefined;
      if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
      if (row.confirmed_at) return undefined;
      const seconds = Math.ceil((60_000 - (Date.now() - new Date(row.last_sent_at).getTime())) / 1_000);
      if (seconds > 0) throw new AppError('RATE_LIMITED', { status: 429, retryAfterSeconds: seconds });
      this.consumeRate(`email-otp-resend-email:${row.email}`, 3, 60 * 60_000);
      await manager.query(
        `UPDATE email_registration SET challenge_id=$2,code_hash=$3,attempts=0,last_sent_at=now(),
           code_expires_at=LEAST(now()+interval '5 minutes',expires_at) WHERE id=$1`,
        [row.id, nextId, this.emailOtpHash(nextId, code)],
      );
      return { email: row.email };
    });
    if (!outcome) return { challenge_id: null, email_sent: false };
    const emailSent = await this.emailSender?.sendVerificationCode(outcome.email, code) ?? false;
    return { challenge_id: nextId, email_sent: emailSent };
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
    const candidateHash = user?.status === 'ACTIVE' && user.password_hash ? user.password_hash : this.dummyPasswordHash;
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

  async googleLogin(dto: GoogleLoginDto, ip: string): Promise<IssuedSession> {
    this.consumeRate(`google-login:${ip}`, 20, 60_000);
    const identity = await this.verifiedGoogleIdentity(dto.id_token);
    const user = await this.dataSource.transaction(async (manager) => {
      const linked = await manager.query(
        `SELECT u.id,u.username,u.display_name,u.status,u.must_change_password,u.authz_version
           FROM external_identity e JOIN app_user u ON u.id=e.user_id
          WHERE e.provider='GOOGLE' AND e.subject=$1 FOR UPDATE OF u`, [identity.subject],
      ) as Array<Omit<UserRow, 'password_hash'> & { password_hash?: null }>;
      if (linked[0]) {
        if (linked[0].status !== 'ACTIVE') throw new AppError('INVALID_CREDENTIALS', { status: 401 });
        return { ...linked[0], password_hash: null } as UserRow;
      }
      const owner = await manager.query('SELECT id FROM app_user WHERE lower(email)=lower($1) LIMIT 1', [identity.email]) as Array<{ id: string }>;
      if (owner[0]) throw new AppError('GOOGLE_ACCOUNT_LINK_REQUIRED', { status: 409 });
      const username = dto.first_time_username ?? `g_${createHash('sha256').update(identity.subject).digest('hex').slice(0, 24)}`;
      const displayName = [...(identity.name || identity.email.split('@')[0] || username).normalize('NFC').trim()].slice(0, 200).join('');
      const created = await manager.query(
        `INSERT INTO app_user (username,display_name,email,email_verified_at,password_hash,status)
         VALUES ($1,$2,$3,now(),NULL,'ACTIVE') ON CONFLICT DO NOTHING
         RETURNING id,username,display_name,status,must_change_password,authz_version`,
        [username, displayName || username, identity.email],
      ) as Array<Omit<UserRow, 'password_hash'> & { password_hash?: null }>;
      if (!created[0]) {
        const emailOwner = await manager.query('SELECT 1 FROM app_user WHERE lower(email)=lower($1)', [identity.email]) as unknown[];
        if (emailOwner.length) throw new AppError('GOOGLE_ACCOUNT_LINK_REQUIRED', { status: 409 });
        throw new AppError('USERNAME_TAKEN', { status: 409 });
      }
      await manager.query("INSERT INTO external_identity (provider,subject,user_id,email_at_link) VALUES ('GOOGLE',$1,$2,$3)", [identity.subject, created[0].id, identity.email]);
      await manager.query("INSERT INTO role_grant (user_id,role_code,scope_type) VALUES ($1,'CITIZEN','SYSTEM') ON CONFLICT DO NOTHING", [created[0].id]);
      return { ...created[0], password_hash: null } as UserRow;
    });
    return this.startSession(user, dto.client_kind);
  }

  async linkGoogleIdentity(auth: AuthContext, idToken: string): Promise<{ linked: true }> {
    const recent = await this.dataSource.query(
      "SELECT 1 FROM session_family WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND created_at >= now()-interval '15 minutes'",
      [auth.sessionId, auth.userId],
    ) as unknown[];
    if (!recent.length) throw new AppError('SESSION_REAUTH_REQUIRED', { status: 403 });
    const identity = await this.verifiedGoogleIdentity(idToken);
    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.query("SELECT user_id FROM external_identity WHERE provider='GOOGLE' AND subject=$1 FOR UPDATE", [identity.subject]) as Array<{ user_id: string }>;
      if (existing[0]) {
        if (existing[0].user_id !== auth.userId) throw new AppError('GOOGLE_IDENTITY_IN_USE', { status: 409 });
        return;
      }
      const account = await manager.query("SELECT 1 FROM app_user WHERE id=$1 AND status='ACTIVE' FOR UPDATE", [auth.userId]) as unknown[];
      if (!account.length) throw new AppError('SESSION_EXPIRED', { status: 401 });
      const alreadyLinked = await manager.query("SELECT 1 FROM external_identity WHERE user_id=$1 AND provider='GOOGLE'", [auth.userId]) as unknown[];
      if (alreadyLinked.length) throw new AppError('GOOGLE_ALREADY_LINKED', { status: 409 });
      await manager.query("INSERT INTO external_identity (provider,subject,user_id,email_at_link) VALUES ('GOOGLE',$1,$2,$3)", [identity.subject, auth.userId, identity.email]);
    });
    return { linked: true };
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
    const candidateHash = user?.status === 'ACTIVE' && user.password_hash ? user.password_hash : this.dummyPasswordHash;
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
      'SELECT id, username, display_name, email, email_verified_at, must_change_password FROM app_user WHERE id = $1 AND status = \'ACTIVE\'',
      [userId],
    ) as Array<{ id: string; username: string; display_name: string; email: string | null; email_verified_at: Date | null; must_change_password: boolean }>;
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

  hashTemporaryPasswordBinding(password: string): string {
    return hashPurposeBoundSecret(password, 'identity-admin-temporary-password-idempotency', this.config.refreshPeppers, this.config.currentRefreshPepperVersion);
  }

  private async startSession(user: UserRow, clientKind: 'WEB' | 'NATIVE'): Promise<IssuedSession> {
    const familyId = randomUUID();
    const refreshToken = randomBytes(32).toString('base64url');
    const family = await this.dataSource.transaction(async (manager) => {
      const current = await manager.query('SELECT status,authz_version FROM app_user WHERE id=$1 FOR SHARE', [user.id]) as Array<{ status: string; authz_version: number }>;
      if (current[0]?.status !== 'ACTIVE' || Number(current[0].authz_version) !== Number(user.authz_version)) return undefined;
      const rows = await manager.query(
        'INSERT INTO session_family (id,user_id,client_kind,authz_version,absolute_expires_at) VALUES ($1,$2,$3,$4,now()+interval \'7 days\') RETURNING absolute_expires_at',
        [familyId, user.id, clientKind, current[0].authz_version],
      ) as Array<{ absolute_expires_at: Date }>;
      await manager.query('INSERT INTO refresh_session (token_hash,family_id) VALUES ($1,$2)', [this.refreshHash(refreshToken), familyId]);
      return rows[0]?.absolute_expires_at;
    });
    if (!family) throw new AppError('INVALID_CREDENTIALS', { status: 401 });
    return this.issueSession(user, familyId, clientKind, refreshToken, family);
  }

  private async verifiedGoogleIdentity(idToken: string): Promise<{ subject: string; email: string; name: string }> {
    if (!this.config.googleClientIds.length) throw new AppError('GOOGLE_LOGIN_UNAVAILABLE', { status: 503 });
    try {
      const ticket = await this.googleClient.verifyIdToken({ idToken, audience: [...this.config.googleClientIds] });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) throw new Error('invalid Google identity');
      return { subject: payload.sub, email: payload.email.trim().toLowerCase(), name: payload.name ?? '' };
    } catch {
      throw new AppError('GOOGLE_TOKEN_INVALID', { status: 401 });
    }
  }

  private emailOtpHash(challengeId: string, code: string): string {
    if (!this.config.emailOtpPepper) throw new AppError('EMAIL_OTP_UNAVAILABLE', { status: 503 });
    return createHmac('sha256', this.config.emailOtpPepper).update('c48.email-otp.v1\0').update(challengeId).update('\0').update(code).digest('hex');
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
