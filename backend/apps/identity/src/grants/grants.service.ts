import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, ResourceRef } from '@c48/technical/idempotency/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { AdminRequest, IdentityAdminSupport } from '../admin/admin-security';
import { CreateGrantDto, GrantListQueryDto, RevokeGrantDto } from './grants.dto';
import { grantScopeIsValid, isSelfGrant } from './grant-scope';
import { CampaignScopeService } from './campaign-scope.service';

interface GrantRow {
  id: string;
  user_id: string;
  role_code: string;
  scope_type: string;
  organization_id: string | null;
  region_code: string | null;
  campaign_id: string | null;
  created_at: Date;
  revoked_at: Date | null;
}

function publicGrant(row: GrantRow): Record<string, unknown> {
  return { ...row, created_at: new Date(row.created_at).toISOString(), revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null };
}

async function readGrant(manager: Pick<EntityManager, 'query'>, id: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT id, user_id, role_code, scope_type, organization_id, region_code, campaign_id, created_at, revoked_at
       FROM role_grant WHERE id = $1`, [id],
  ) as GrantRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return publicGrant(rows[0]);
}

@Injectable()
export class GrantsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly support: IdentityAdminSupport,
    private readonly campaigns: CampaignScopeService,
  ) {}

  async list(userId: string, dto: GrantListQueryDto): Promise<Record<string, unknown>> {
    const includeRevoked = dto.include_revoked === 'true';
    const filters = { user_id: userId, include_revoked: includeRevoked };
    const cursor = dto.cursor ? decodeKeysetCursor(dto.cursor, filters) : null;
    if (cursor && (cursor.sort.length !== 2 || typeof cursor.sort[0] !== 'number' || typeof cursor.sort[1] !== 'string')) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }
    const values: unknown[] = [userId];
    let where = 'user_id = $1';
    if (!includeRevoked) where += ' AND revoked_at IS NULL';
    if (cursor) {
      const [rank, createdAt] = cursor.sort as [number, string];
      if (![0, 1].includes(rank)) throw new AppError('CURSOR_INVALID', { status: 400 });
      values.push(rank, createdAt, cursor.id);
      const rankSlot = values.length - 2;
      where += ` AND (((revoked_at IS NOT NULL)::int > $${rankSlot}) OR
                        ((revoked_at IS NOT NULL)::int = $${rankSlot} AND (created_at, id) < ($${rankSlot + 1}::timestamptz, $${rankSlot + 2}::uuid)))`;
    }
    values.push(Math.min(dto.limit ?? 50, 100) + 1);
    const rows = await this.dataSource.query(
      `SELECT id, user_id, role_code, scope_type, organization_id, region_code, campaign_id, created_at, revoked_at
         FROM role_grant WHERE ${where}
        ORDER BY (revoked_at IS NOT NULL) ASC, created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    ) as GrantRow[];
    const more = rows.length > (dto.limit ?? 50);
    const items = rows.slice(0, dto.limit ?? 50);
    const last = items.at(-1);
    return {
      items: items.map(publicGrant),
      next_cursor: more && last
        ? encodeKeysetCursor([last.revoked_at ? 1 : 0, new Date(last.created_at).toISOString()], last.id, filters)
        : null,
    };
  }

  async create(userId: string, dto: CreateGrantDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    if (isSelfGrant(actorId, userId)) throw new AppError('FORBIDDEN', { status: 403 });
    if (!grantScopeIsValid(dto)) throw new AppError('SCOPE_INVALID', { status: 400 });
    if (dto.scope_type === 'CAMPAIGN') await this.campaigns.assertActiveCampaign(dto.campaign_id!, dto.organization_id!);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.grants.create', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash({ userId, ...dto }), databaseErrorMappings: { unique: { role_grant_live_uq: 'GRANT_EXISTS' } },
      execute: async (manager) => {
        await this.support.lockAdminChanges(manager);
        await this.support.bumpAuthzVersion(manager, userId);
        await this.support.revokeSessions(manager, userId, 'ROLE_CHANGE');
        if (dto.organization_id) {
          const organizations = await manager.query("SELECT id FROM organization WHERE id = $1 AND status = 'ACTIVE' FOR SHARE", [dto.organization_id]) as Array<{ id: string }>;
          if (!organizations[0]) throw new AppError('SCOPE_INVALID', { status: 400 });
        }
        if (dto.region_code) {
          const regions = await manager.query("SELECT code FROM region WHERE code = $1 AND status = 'ACTIVE' FOR SHARE", [dto.region_code]) as Array<{ code: string }>;
          if (!regions[0]) throw new AppError('SCOPE_INVALID', { status: 400 });
        }
        const rows = await manager.query(
          `INSERT INTO role_grant (user_id, role_code, scope_type, organization_id, region_code, campaign_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [userId, dto.role_code, dto.scope_type, dto.organization_id ?? null, dto.region_code ?? null, dto.campaign_id ?? null],
        ) as Array<{ id: string }>;
        const id = rows[0]!.id;
        const value = await readGrant(manager, id);
        await this.support.audit(manager, actorId, 'GRANT_CREATED', 'role_grant', id, null,
          { ...value, reason: dto.reason }, dto.reason);
        return { status: 201, value, resource: { type: 'role_grant', id } };
      },
      replay: async (manager, resource) => readGrant(manager, this.resourceId(resource)),
    });
  }

  async revoke(id: string, dto: RevokeGrantDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    const existing = await this.dataSource.query('SELECT user_id FROM role_grant WHERE id = $1', [id]) as Array<{ user_id: string }>;
    if (!existing[0]) throw new AppError('NOT_FOUND', { status: 404 });
    const userId = existing[0].user_id;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.grants.revoke', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash({ id, ...dto }),
      execute: async (manager) => {
        await this.support.lockAdminChanges(manager);
        const [bumped] = await manager.query(
          'UPDATE app_user SET authz_version = authz_version + 1, version = version + 1 WHERE id = $1 RETURNING id', [userId],
        ) as [Array<{ id: string }>, number];
        if (!bumped[0]) throw new AppError('NOT_FOUND', { status: 404 });
        await this.support.revokeSessions(manager, userId, 'ROLE_CHANGE');
        const rows = await manager.query('SELECT * FROM role_grant WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]) as GrantRow[];
        const before = rows[0];
        if (!before) throw new AppError('NOT_FOUND', { status: 404 });
        if (before.revoked_at) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (before.role_code === 'ADMIN') {
          const active = await manager.query("SELECT status FROM app_user WHERE id = $1", [userId]) as Array<{ status: string }>;
          if (active[0]?.status === 'ACTIVE') await this.support.assertAnotherActiveAdmin(manager, userId);
        }
        const [updated] = await manager.query(
          'UPDATE role_grant SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id', [id],
        ) as [Array<{ id: string }>, number];
        if (!updated[0]) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const value = await readGrant(manager, id);
        await this.support.audit(manager, actorId, 'GRANT_REVOKED', 'role_grant', id, publicGrant(before), {
          ...value, reason: dto.reason,
        }, dto.reason);
        return { status: 200, value, resource: { type: 'role_grant', id } };
      },
      replay: async (manager, resource) => readGrant(manager, this.resourceId(resource)),
    });
  }

  private resourceId(resource: ResourceRef | null): string {
    if (!resource || resource.type !== 'role_grant') throw new AppError('INTERNAL_ERROR', { status: 500 });
    return resource.id;
  }
}
