import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors';
import { canonicalRequestHash, IdempotencyService, ResourceRef } from '../../../../packages/technical/src/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/keyset';
import { AuthService } from '../auth/auth.service';
import { AdminRequest, IdentityAdminSupport } from '../admin/admin-security';
import { CreateUserDto, ResetPasswordDto, UserListQueryDto, UserVersionActionDto } from './users.dto';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  must_change_password: boolean;
  version: number;
  created_at: Date;
}

function publicUser(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    status: row.status,
    must_change_password: row.must_change_password,
    version: Number(row.version),
    created_at: new Date(row.created_at).toISOString(),
  };
}

async function readUser(manager: Pick<EntityManager, 'query'>, id: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT id, username, display_name, status, must_change_password, version, created_at
       FROM app_user WHERE id = $1`, [id],
  ) as UserRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return publicUser(rows[0]);
}

@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly support: IdentityAdminSupport,
    private readonly authService: AuthService,
  ) {}

  async list(dto: UserListQueryDto): Promise<Record<string, unknown>> {
    const query = dto.query?.trim() || null;
    const filters = { query: query?.toLowerCase() ?? null, status: dto.status ?? null };
    const cursor = dto.cursor ? decodeKeysetCursor(dto.cursor, filters) : null;
    if (cursor && cursor.sort.length !== 1) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    const where: string[] = [];
    if (dto.status) {
      values.push(dto.status);
      where.push(`status = $${values.length}`);
    }
    if (query) {
      const escaped = query.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
      values.push(escaped);
      const index = values.length;
      where.push(`(lower(username::text) LIKE $${index} ESCAPE E'\\\\' OR lower(display_name) LIKE $${index} ESCAPE E'\\\\')`);
    }
    if (cursor) {
      if (typeof cursor.sort[0] !== 'string') throw new AppError('CURSOR_INVALID', { status: 400 });
      values.push(cursor.sort[0], cursor.id);
      where.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(Math.min(dto.limit ?? 50, 100) + 1);
    const rows = await this.dataSource.query(
      `SELECT id, username, display_name, status, must_change_password, version, created_at
         FROM app_user${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    ) as UserRow[];
    const more = rows.length > (dto.limit ?? 50);
    const items = rows.slice(0, dto.limit ?? 50);
    const last = items.at(-1);
    return {
      items: items.map(publicUser),
      next_cursor: more && last ? encodeKeysetCursor([new Date(last.created_at).toISOString()], last.id, filters) : null,
    };
  }

  async get(id: string): Promise<Record<string, unknown>> {
    const user = await readUser(this.dataSource, id);
    const [memberships, grants] = await Promise.all([
      this.dataSource.query(
        `SELECT o.id AS organization_id, o.name, o.organization_kind, m.status
           FROM membership m JOIN organization o ON o.id = m.organization_id
          WHERE m.user_id = $1 ORDER BY o.created_at DESC, o.id DESC`, [id],
      ) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(
        `SELECT id, role_code, scope_type, organization_id, region_code, campaign_id, created_at, revoked_at
           FROM role_grant WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC, id DESC`, [id],
      ) as Promise<Array<Record<string, unknown>>>,
    ]);
    return { ...user, memberships, grants };
  }

  async create(dto: CreateUserDto, actor: AdminRequest): Promise<{ status: number; value: Record<string, unknown>; replay: boolean }> {
    const actorId = actor.auth!.userId;
    const passwordHash = await this.authService.hashTemporaryPassword(dto.temporary_password, dto.username);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`,
      command: 'identity.users.create',
      key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash(dto),
      databaseErrorMappings: { unique: { app_user_username_key: 'USERNAME_TAKEN' } },
      execute: async (manager) => {
        if (dto.organization_id) {
          const orgs = await manager.query("SELECT id FROM organization WHERE id = $1 AND status = 'ACTIVE' FOR SHARE", [dto.organization_id]) as Array<{ id: string }>;
          if (!orgs[0]) throw new AppError('NOT_FOUND', { status: 404 });
        }
        const inserted = await manager.query(
          `INSERT INTO app_user (username, display_name, password_hash, must_change_password)
           VALUES ($1, $2, $3, true) RETURNING id`,
          [dto.username, dto.display_name.trim(), passwordHash],
        ) as Array<{ id: string }>;
        const id = inserted[0]!.id;
        await this.support.audit(manager, actorId, 'USER_CREATED', 'app_user', id, null, {
          id, username: dto.username, display_name: dto.display_name.trim(), status: 'ACTIVE', must_change_password: true,
        }, null);
        if (dto.organization_id) {
          await manager.query('INSERT INTO membership (user_id, organization_id) VALUES ($1, $2)', [id, dto.organization_id]);
          await this.support.audit(manager, actorId, 'MEMBERSHIP_ADDED', 'membership', `${dto.organization_id}:${id}`, null, {
            user_id: id, organization_id: dto.organization_id, status: 'ACTIVE',
          }, null);
        }
        return { status: 201, value: await readUser(manager, id), resource: { type: 'app_user', id } };
      },
      replay: async (manager, resource) => readUser(manager, this.resourceId(resource)),
    });
  }

  async setStatus(id: string, action: 'disable' | 'enable', dto: UserVersionActionDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: `identity.users.${action}`, key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash({ id, ...dto }),
      execute: async (manager) => {
        if (action === 'disable') await this.support.lockAdminChanges(manager);
        const before = await this.support.getUser(manager, id, true);
        if (Number(before.version) !== dto.expected_version) throw new AppError('VERSION_CONFLICT', { status: 409 });
        if (before.status !== (action === 'disable' ? 'ACTIVE' : 'DISABLED')) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (action === 'disable') {
          const admins = await manager.query(
            `SELECT EXISTS (SELECT 1 FROM role_grant WHERE user_id = $1 AND role_code = 'ADMIN' AND revoked_at IS NULL) AS is_admin`, [id],
          ) as Array<{ is_admin: boolean }>;
          if (admins[0]?.is_admin) {
            await this.support.assertAnotherActiveAdmin(manager, id);
          }
        }
        const nextStatus = action === 'disable' ? 'DISABLED' : 'ACTIVE';
        const authzChange = action === 'disable' ? ', authz_version = authz_version + 1' : '';
        const [rows] = await manager.query(
          `UPDATE app_user SET status = $1, version = version + 1${authzChange}
            WHERE id = $2 AND version = $3 RETURNING id, username, display_name, status, must_change_password, version, created_at`,
          [nextStatus, id, dto.expected_version],
        ) as [UserRow[], number];
        if (!rows[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const after = publicUser(rows[0]);
        if (action === 'disable') await this.support.revokeSessions(manager, id, 'DISABLED');
        await this.support.audit(manager, actorId, action === 'disable' ? 'USER_DISABLED' : 'USER_ENABLED', 'app_user', id,
          { status: before.status, must_change_password: before.must_change_password, version: before.version },
          { status: after.status, must_change_password: after.must_change_password, version: after.version }, dto.reason);
        return { status: 200, value: after, resource: { type: 'app_user', id } };
      },
      replay: async (manager, resource) => readUser(manager, this.resourceId(resource)),
    });
  }

  async resetPassword(id: string, dto: ResetPasswordDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    const current = await this.dataSource.query('SELECT username FROM app_user WHERE id = $1', [id]) as Array<{ username: string }>;
    if (!current[0]) throw new AppError('NOT_FOUND', { status: 404 });
    const passwordHash = await this.authService.hashTemporaryPassword(dto.temporary_password, current[0].username);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.users.reset-password', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash({ id, ...dto }),
      execute: async (manager) => {
        const before = await this.support.getUser(manager, id, true);
        if (Number(before.version) !== dto.expected_version) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const [rows] = await manager.query(
          `UPDATE app_user SET password_hash = $1, must_change_password = true,
                  authz_version = authz_version + 1, version = version + 1
            WHERE id = $2 AND version = $3
            RETURNING id, username, display_name, status, must_change_password, version, created_at`,
          [passwordHash, id, dto.expected_version],
        ) as [UserRow[], number];
        if (!rows[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        await this.support.revokeSessions(manager, id, 'PASSWORD_RESET');
        const after = publicUser(rows[0]);
        await this.support.audit(manager, actorId, 'USER_PASSWORD_RESET', 'app_user', id,
          { status: before.status, must_change_password: before.must_change_password, version: before.version },
          { status: after.status, must_change_password: true, version: after.version }, dto.reason);
        return { status: 204, value: after, resource: { type: 'app_user', id } };
      },
      replay: async (manager, resource) => readUser(manager, this.resourceId(resource)),
    });
  }

  private resourceId(resource: ResourceRef | null): string {
    if (!resource || resource.type !== 'app_user') throw new AppError('INTERNAL_ERROR', { status: 500 });
    return resource.id;
  }
}
