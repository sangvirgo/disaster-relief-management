import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef } from '../../../../packages/technical/src/idempotency/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { Grant, hasPermission } from '../../../../packages/identity-contracts/src/permissions';
import { CampaignActionDto, CampaignCreateDto, CampaignPageQueryDto, CampaignPatchDto, CampaignReasonActionDto } from './campaigns.dto';
import {
  campaignNextStatus, campaignScopePredicate, campaignView, cleanCampaignName, CampaignAction, CampaignRow,
  CampaignStatus, publicCampaignView, validCampaignCursor, validateCampaignDates,
} from './campaigns.helpers';
import { ReporterSession, ReporterSessionService } from '../requests/reporter-session';

export interface CampaignCommandRequest extends Request {
  idempotencyKey?: string;
}

type CampaignPage = { items: Record<string, unknown>[]; more: boolean; cursor?: string };

const campaignColumns = `id,organization_id,region_code,name,objective,status,starts_at,ends_at,version,created_at,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`;

@Injectable()
export class CampaignsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(dto: CampaignCreateDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const regionCode = dto.region_code ?? null;
    const organizationId = this.organizationForCreate(session.grants, regionCode);
    const name = cleanCampaignName(dto.name);
    validateCampaignDates(dto.starts_at, dto.ends_at);
    await this.assertRegion(this.dataSource, regionCode);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'response.campaign.create',
      key,
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, organization_id: organizationId, dto }),
      execute: async (manager) => {
        const rows = await manager.query(
          `INSERT INTO campaign (organization_id,region_code,name,objective,starts_at,ends_at,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${campaignColumns}`,
          [organizationId, regionCode, name, dto.objective ?? null, dto.starts_at ?? null, dto.ends_at ?? null, session.userId],
        ) as CampaignRow[];
        const row = rows[0];
        if (!row) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const value = campaignView(row);
        await this.audit(manager, session.userId, 'CAMPAIGN_CREATED', row.id, null, value, null);
        return { status: 201, value, resource: { type: 'campaign', id: row.id } };
      },
      replay: async (manager, resource) => {
        const row = await this.replayCampaign(manager, resource, session, 'CAMPAIGN_MANAGE');
        return campaignView(row);
      },
    });
  }

  async list(query: CampaignPageQueryDto, request: Request): Promise<CampaignPage> {
    const session = await this.sessions.require(request);
    const filters = { user_id: session.userId, grants: session.grants };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validCampaignCursor(cursor.sort, cursor.id)) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    const scope = campaignScopePredicate(session.grants, 'CAMPAIGN_READ', values);
    const where = cursor
      ? `${scope} AND (created_at,id) < ($${values.length + 1}::timestamptz,$${values.length + 2}::uuid)`
      : scope;
    if (cursor) values.push(cursor.sort[0], cursor.id);
    return this.page(
      this.dataSource.query(`SELECT ${campaignColumns} FROM campaign WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1}`,
        [...values, (query.limit ?? 50) + 1]) as Promise<CampaignRow[]>,
      query.limit ?? 50,
      filters,
    );
  }

  async detail(id: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const row = await this.findCampaign(this.dataSource, id);
    this.assertCampaignPermission(session, row, 'CAMPAIGN_READ');
    return campaignView(row);
  }

  async patch(id: string, dto: CampaignPatchDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const changed = ['name', 'objective', 'region_code', 'starts_at', 'ends_at'].some((field) => Object.hasOwn(dto, field));
    if (!changed) throw new AppError('VALIDATION_FAILED', { status: 400 });
    const name = dto.name === undefined ? undefined : cleanCampaignName(dto.name);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'response.campaign.patch',
      key,
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, campaign_id: id, dto }),
      execute: async (manager) => {
        const row = await this.findCampaign(manager, id, true);
        this.assertCampaignPermission(session, row, 'CAMPAIGN_MANAGE');
        this.assertVersion(row, dto.expected_version);
        if (row.status !== 'DRAFT') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (dto.region_code !== undefined) {
          this.assertCampaignPermission(session, { ...row, region_code: dto.region_code }, 'CAMPAIGN_MANAGE');
        }
        if (dto.region_code !== undefined) await this.assertRegion(manager, dto.region_code);
        validateCampaignDates(
          dto.starts_at === undefined ? row.starts_at : dto.starts_at,
          dto.ends_at === undefined ? row.ends_at : dto.ends_at,
        );
        const [updated] = await manager.query(
          `UPDATE campaign SET
             name=CASE WHEN $3::boolean THEN $4::text ELSE name END,
             objective=CASE WHEN $5::boolean THEN $6::text ELSE objective END,
             region_code=CASE WHEN $7::boolean THEN $8::text ELSE region_code END,
             starts_at=CASE WHEN $9::boolean THEN $10::timestamptz ELSE starts_at END,
             ends_at=CASE WHEN $11::boolean THEN $12::timestamptz ELSE ends_at END,
             version=version+1 WHERE id=$1 AND version=$2 RETURNING ${campaignColumns}`,
          [id, dto.expected_version, dto.name !== undefined, name ?? null, dto.objective !== undefined, dto.objective ?? null,
            dto.region_code !== undefined, dto.region_code ?? null, dto.starts_at !== undefined, dto.starts_at ?? null,
            dto.ends_at !== undefined, dto.ends_at ?? null],
        ) as [CampaignRow[], number];
        const next = updated[0];
        if (!next) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
        const before = campaignView(row);
        const value = campaignView(next);
        await this.audit(manager, session.userId, 'CAMPAIGN_UPDATED', id, before, value, null);
        return { status: 200, value, resource: { type: 'campaign', id } };
      },
      replay: async (manager, resource) => campaignView(await this.replayCampaign(manager, resource, session, 'CAMPAIGN_MANAGE')),
    });
  }

  async transition(
    id: string,
    action: CampaignAction,
    dto: CampaignActionDto | CampaignReasonActionDto,
    key: string,
    request: Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: `response.campaign.${action}`,
      key,
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, campaign_id: id, action, dto }),
      execute: async (manager) => {
        const row = await this.findCampaign(manager, id, true);
        this.assertCampaignPermission(session, row, 'CAMPAIGN_MANAGE');
        this.assertVersion(row, dto.expected_version);
        const status = campaignNextStatus(row.status, action);
        const reason = 'reason' in dto ? dto.reason : null;
        if ((action === 'pause' || action === 'close') && (!reason || !reason.trim())) {
          throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { reason: ['VALIDATION_FAILED'] } });
        }
        if (action === 'close') {
          const open = await manager.query(
            `SELECT 1 FROM assistance_request
              WHERE campaign_id=$1 AND canonical_request_id IS NULL
                AND status NOT IN ('REJECTED','DUPLICATE','RESOLVED','CLOSED','CANCELLED') LIMIT 1`,
            [id],
          ) as unknown[];
          if (open.length) throw new AppError('CAMPAIGN_HAS_OPEN_REQUESTS', { status: 409 });
        }
        const [updated] = await manager.query(
          `UPDATE campaign SET status=$3,version=version+1
            WHERE id=$1 AND version=$2 RETURNING ${campaignColumns}`,
          [id, dto.expected_version, status],
        ) as [CampaignRow[], number];
        const next = updated[0];
        if (!next) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
        const before = campaignView(row);
        const value = campaignView(next);
        await this.audit(manager, session.userId, `CAMPAIGN_${action.toUpperCase()}`, id, before, value, reason);
        return { status: 200, value, resource: { type: 'campaign', id } };
      },
      replay: async (manager, resource) => campaignView(await this.replayCampaign(manager, resource, session, 'CAMPAIGN_MANAGE')),
    });
  }

  async publicList(query: CampaignPageQueryDto): Promise<CampaignPage> {
    const filters = { status: ['ACTIVE', 'PAUSED'] };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validCampaignCursor(cursor.sort, cursor.id)) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    const cursorClause = cursor ? ' AND (created_at,id) < ($1::timestamptz,$2::uuid)' : '';
    if (cursor) values.push(cursor.sort[0], cursor.id);
    values.push((query.limit ?? 50) + 1);
    const rows = await this.dataSource.query(
      `SELECT ${campaignColumns} FROM campaign WHERE status IN ('ACTIVE','PAUSED')${cursorClause}
       ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
      values,
    ) as CampaignRow[];
    const more = rows.length > (query.limit ?? 50);
    const items = rows.slice(0, query.limit ?? 50);
    const codes = [...new Set(items.flatMap((row) => row.region_code ? [row.region_code] : []))];
    const names = codes.length ? await this.sessions.lookupRegionNames(codes) : new Map<string, string>();
    const last = items.at(-1);
    return {
      items: items.map((row) => publicCampaignView(row, row.region_code ? names.get(row.region_code) ?? null : null)),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_created_at!], last.id, filters) } : {}),
    };
  }

  async internal(id: string): Promise<Record<string, unknown>> {
    const row = await this.findCampaign(this.dataSource, id);
    return {
      id: row.id,
      status: row.status,
      organization_id: row.organization_id,
      region_code: row.region_code,
      version: Number(row.version),
    };
  }

  private async page(rowsPromise: Promise<CampaignRow[]>, limit: number, filters: unknown): Promise<CampaignPage> {
    const rows = await rowsPromise;
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(campaignView),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_created_at!], last.id, filters) } : {}),
    };
  }

  private async findCampaign(query: DataSource | EntityManager, id: string, forUpdate = false): Promise<CampaignRow> {
    const rows = await query.query(
      `SELECT ${campaignColumns} FROM campaign WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    ) as CampaignRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async replayCampaign(manager: EntityManager, resource: ResourceRef | null, session: ReporterSession, permission: 'CAMPAIGN_READ' | 'CAMPAIGN_MANAGE'): Promise<CampaignRow> {
    if (!resource || resource.type !== 'campaign') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const row = await this.findCampaign(manager, resource.id);
    this.assertCampaignPermission(session, row, permission);
    return row;
  }

  private organizationForCreate(grants: readonly Grant[], regionCode: string | null): string {
    const organizations = new Set(grants.flatMap((grant) => grant.organization_id ? [grant.organization_id] : []));
    const matching = [...organizations].filter((organizationId) => hasPermission(grants, 'CAMPAIGN_MANAGE', {
      organizationId, regionCode,
    }));
    if (matching.length !== 1) throw new AppError('FORBIDDEN', { status: 403 });
    return matching[0]!;
  }

  private assertCampaignPermission(session: ReporterSession, row: CampaignRow, permission: 'CAMPAIGN_READ' | 'CAMPAIGN_MANAGE'): void {
    if (!hasPermission(session.grants, permission, {
      organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.id,
    })) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private assertVersion(row: CampaignRow, expected: number): void {
    if (Number(row.version) !== expected) {
      throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
    }
  }

  private async assertRegion(query: DataSource | EntityManager, regionCode: string | null): Promise<void> {
    if (!regionCode) return;
    const rows = await query.query('SELECT 1 FROM region_boundary WHERE region_code=$1', [regionCode]) as unknown[];
    if (!rows.length) {
      throw new AppError('VALIDATION_FAILED', {
        status: 400, fieldErrors: { region_code: ['Mã khu vực không hợp lệ hoặc chưa được cấu hình.'] },
      });
    }
  }

  private async audit(
    manager: EntityManager,
    actorId: string,
    action: string,
    id: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason: string | null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
       VALUES ($1,$2,'campaign',$3,$4::jsonb,$5::jsonb,$6)`,
      [actorId, action, id, before ? JSON.stringify(before) : null, JSON.stringify(after), reason],
    );
  }
}
