import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors';
import { canonicalRequestHash, IdempotencyService, ResourceRef } from '../../../../packages/technical/src/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/keyset';
import { AdminRequest, IdentityAdminSupport } from '../admin/admin-security';
import { AddMemberDto, CreateOrganizationDto, OrganizationActionDto, OrganizationListQueryDto } from './organizations.dto';

interface OrganizationRow {
  id: string;
  name: string;
  organization_kind: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  created_at: Date;
}

function publicOrganization(row: OrganizationRow): Record<string, unknown> {
  return { ...row, version: Number(row.version), created_at: new Date(row.created_at).toISOString() };
}

async function readOrganization(manager: Pick<EntityManager, 'query'>, id: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    'SELECT id, name, organization_kind, status, version, created_at FROM organization WHERE id = $1', [id],
  ) as OrganizationRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return publicOrganization(rows[0]);
}

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly support: IdentityAdminSupport,
  ) {}

  async list(dto: OrganizationListQueryDto): Promise<Record<string, unknown>> {
    const filters = {};
    const cursor = dto.cursor ? decodeKeysetCursor(dto.cursor, filters) : null;
    if (cursor && cursor.sort.length !== 1) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    let after = '';
    if (cursor) {
      if (typeof cursor.sort[0] !== 'string') throw new AppError('CURSOR_INVALID', { status: 400 });
      values.push(cursor.sort[0], cursor.id);
      after = `WHERE (created_at, id) < ($1::timestamptz, $2::uuid)`;
    }
    values.push(Math.min(dto.limit ?? 50, 100) + 1);
    const rows = await this.dataSource.query(
      `SELECT id, name, organization_kind, status, version, created_at FROM organization ${after}
        ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    ) as OrganizationRow[];
    const more = rows.length > (dto.limit ?? 50);
    const items = rows.slice(0, dto.limit ?? 50);
    const last = items.at(-1);
    return {
      items: items.map(publicOrganization),
      next_cursor: more && last ? encodeKeysetCursor([new Date(last.created_at).toISOString()], last.id, filters) : null,
    };
  }

  async create(dto: CreateOrganizationDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.organizations.create', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash(dto), databaseErrorMappings: { unique: { organization_name_uq: 'ORGANIZATION_NAME_TAKEN' } },
      execute: async (manager) => {
        const rows = await manager.query(
          'INSERT INTO organization (name, organization_kind) VALUES ($1, $2) RETURNING id',
          [dto.name.trim(), dto.organization_kind],
        ) as Array<{ id: string }>;
        const id = rows[0]!.id;
        const value = await readOrganization(manager, id);
        await this.support.audit(manager, actorId, 'ORGANIZATION_CREATED', 'organization', id, null, {
          id, name: dto.name.trim(), organization_kind: dto.organization_kind, status: 'ACTIVE', version: 1,
        }, null);
        return { status: 201, value, resource: { type: 'organization', id } };
      },
      replay: async (manager, resource) => readOrganization(manager, this.resourceId(resource)),
    });
  }

  async deactivate(id: string, dto: OrganizationActionDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.organizations.deactivate', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash({ id, ...dto }),
      execute: async (manager) => {
        const rows = await manager.query('SELECT id, name, organization_kind, status, version FROM organization WHERE id = $1 FOR UPDATE', [id]) as OrganizationRow[];
        const before = rows[0];
        if (!before) throw new AppError('NOT_FOUND', { status: 404 });
        if (Number(before.version) !== dto.expected_version) throw new AppError('VERSION_CONFLICT', { status: 409 });
        if (before.status !== 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const use = await manager.query(
          `SELECT EXISTS (SELECT 1 FROM membership WHERE organization_id = $1 AND status = 'ACTIVE') OR
                  EXISTS (SELECT 1 FROM role_grant WHERE organization_id = $1 AND revoked_at IS NULL) AS in_use`, [id],
        ) as Array<{ in_use: boolean }>;
        if (use[0]?.in_use) throw new AppError('ORGANIZATION_IN_USE', { status: 409 });
        const [updated] = await manager.query(
          `UPDATE organization SET status = 'INACTIVE', version = version + 1
            WHERE id = $1 AND version = $2 RETURNING id, name, organization_kind, status, version, created_at`,
          [id, dto.expected_version],
        ) as [OrganizationRow[], number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const value = publicOrganization(updated[0]);
        await this.support.audit(manager, actorId, 'ORGANIZATION_DEACTIVATED', 'organization', id,
          { status: before.status, version: before.version }, { status: value.status, version: value.version }, dto.reason);
        return { status: 200, value, resource: { type: 'organization', id } };
      },
      replay: async (manager, resource) => readOrganization(manager, this.resourceId(resource)),
    });
  }

  async addMember(organizationId: string, dto: AddMemberDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.organizations.members.add', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash({ organizationId, ...dto }),
      execute: async (manager) => {
        const organizations = await manager.query("SELECT id FROM organization WHERE id = $1 AND status = 'ACTIVE' FOR SHARE", [organizationId]) as Array<{ id: string }>;
        if (!organizations[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const users = await manager.query('SELECT id FROM app_user WHERE id = $1', [dto.user_id]) as Array<{ id: string }>;
        if (!users[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const existing = await manager.query('SELECT status FROM membership WHERE user_id = $1 AND organization_id = $2 FOR UPDATE', [dto.user_id, organizationId]) as Array<{ status: string }>;
        if (existing[0]?.status === 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (existing[0]) {
          await manager.query("UPDATE membership SET status = 'ACTIVE' WHERE user_id = $1 AND organization_id = $2", [dto.user_id, organizationId]);
        } else {
          await manager.query('INSERT INTO membership (user_id, organization_id) VALUES ($1, $2)', [dto.user_id, organizationId]);
        }
        await this.support.audit(manager, actorId, 'MEMBERSHIP_ADDED', 'membership', `${organizationId}:${dto.user_id}`,
          existing[0] ? { status: 'INACTIVE' } : null, { user_id: dto.user_id, organization_id: organizationId, status: 'ACTIVE' }, null);
        return { status: 201, value: { user_id: dto.user_id, organization_id: organizationId, status: 'ACTIVE' }, resource: { type: 'membership', id: dto.user_id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'membership') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const rows = await manager.query('SELECT user_id, organization_id, status FROM membership WHERE user_id = $1 AND organization_id = $2', [resource.id, organizationId]) as Array<Record<string, unknown>>;
        if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return rows[0];
      },
    });
  }

  async removeMember(organizationId: string, userId: string, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.organizations.members.remove', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash({ organizationId, userId }),
      execute: async (manager) => {
        await this.support.bumpAuthzVersion(manager, userId);
        await this.support.revokeSessions(manager, userId, 'ROLE_CHANGE');
        const rows = await manager.query('SELECT status FROM membership WHERE user_id = $1 AND organization_id = $2 FOR UPDATE', [userId, organizationId]) as Array<{ status: string }>;
        if (rows[0]?.status !== 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const grants = await manager.query(
          `SELECT id, role_code, scope_type, organization_id, region_code, campaign_id, created_at
             FROM role_grant WHERE user_id = $1 AND organization_id = $2 AND revoked_at IS NULL FOR UPDATE`,
          [userId, organizationId],
        ) as Array<Record<string, unknown>>;
        await manager.query('UPDATE role_grant SET revoked_at = now() WHERE user_id = $1 AND organization_id = $2 AND revoked_at IS NULL', [userId, organizationId]);
        for (const grant of grants) {
          await this.support.audit(manager, actorId, 'GRANT_REVOKED', 'role_grant', String(grant.id), grant,
            { ...grant, revoked_at: new Date().toISOString() }, 'Tư cách thành viên tổ chức đã bị gỡ.');
        }
        await manager.query("UPDATE membership SET status = 'INACTIVE' WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
        await this.support.audit(manager, actorId, 'MEMBERSHIP_REMOVED', 'membership', `${organizationId}:${userId}`,
          { user_id: userId, organization_id: organizationId, status: 'ACTIVE' },
          { user_id: userId, organization_id: organizationId, status: 'INACTIVE' }, null);
        return { status: 204, value: undefined, resource: null };
      },
      replay: async () => undefined,
    });
  }

  private resourceId(resource: ResourceRef | null): string {
    if (!resource || resource.type !== 'organization') throw new AppError('INTERNAL_ERROR', { status: 500 });
    return resource.id;
  }
}
