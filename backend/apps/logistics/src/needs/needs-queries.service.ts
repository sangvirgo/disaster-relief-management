import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import type { KeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { hasPermission, ROLE_PERMISSIONS } from '../../../../packages/technical/src/security/permissions';
import type { Grant, Permission } from '../../../../packages/technical/src/security/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import { FulfillmentQueryDto, NeedContributionsQueryDto, NeedsListQueryDto } from './needs.dto';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const readPermissions: readonly Permission[] = ['NEED_MANAGE', 'REPORT_READ'];

interface NeedQueryRow extends Record<string, unknown> {
  id: string;
  cycle_id: string;
  request_id: string;
  work_cycle: number | string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number | string;
  original: string;
  requested: string;
  committed_reserved: string;
  issued_unsettled: string;
  delivered: string;
  returned: string;
  lost: string;
  cancelled_remaining: string | null;
  status: string;
  version: number | string;
  created_at: Date | string;
  cursor_created_at: string;
  contributions?: unknown;
  contributions_more?: boolean;
}

interface CycleRow {
  id: string;
  request_id: string;
  work_cycle: number | string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  state: string;
}

interface ContributionRow extends Record<string, unknown> {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  quantity: string;
  released_quantity: string;
  issued_quantity: string;
  delivered_quantity: string;
  returned_quantity: string;
  lost_quantity: string;
  created_by_user_id: string;
  created_at: Date | string;
  cursor_created_at: string;
}

function filtersFor(route: string, userId: string, grants: readonly Grant[], values: Record<string, unknown>): Record<string, unknown> {
  return { route, user_id: userId, grants, ...values };
}

function validTimeCursor(cursor: KeysetCursor): boolean {
  if (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string' || !uuidPattern.test(cursor.id)) return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3,6})Z$/u.exec(cursor.sort[0]);
  if (!match) return false;
  const milliseconds = match[2]!.slice(0, 3).padEnd(3, '0');
  const normalized = `${match[1]}.${milliseconds}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) && date.toISOString() === normalized;
}

function scopeSql(grants: readonly Grant[], values: unknown[], alias: string): string {
  const branches = new Set<string>();
  for (const grant of grants) {
    const permissions = ROLE_PERMISSIONS[grant.role_code] as readonly Permission[];
    const permission = readPermissions.find((candidate) => permissions.includes(candidate));
    if (!permission) continue;

    if (grant.scope_type === 'SYSTEM') {
      if (hasPermission([grant], permission, { systemAction: permission })) branches.add('TRUE');
      continue;
    }
    if (!grant.organization_id) continue;
    if (grant.scope_type === 'ORGANIZATION' && !grant.region_code && !grant.campaign_id) {
      if (!hasPermission([grant], permission, { organizationId: grant.organization_id, regionCode: '__scope_check__' })) continue;
      values.push(grant.organization_id);
      branches.add(`${alias}.organization_id=$${values.length}`);
    } else if (grant.scope_type === 'REGION' && grant.region_code && !grant.campaign_id) {
      if (!hasPermission([grant], permission, { organizationId: grant.organization_id, regionCode: grant.region_code })) continue;
      values.push(grant.organization_id, grant.region_code);
      branches.add(`(${alias}.organization_id=$${values.length - 1} AND ${alias}.region_code=$${values.length})`);
    } else if (grant.scope_type === 'CAMPAIGN' && grant.campaign_id && !grant.region_code) {
      if (!hasPermission([grant], permission, { organizationId: grant.organization_id, campaignId: grant.campaign_id })) continue;
      values.push(grant.organization_id, grant.campaign_id);
      branches.add(`(${alias}.organization_id=$${values.length - 1} AND ${alias}.campaign_id=$${values.length})`);
    }
  }
  if (branches.size === 0) throw new AppError('FORBIDDEN', { status: 403 });
  return `(${[...branches].join(' OR ')})`;
}

function needTotalsQuery(includeContributions = false): string {
  return `
  SELECT n.id,n.cycle_id,c.request_id,c.work_cycle,c.organization_id,c.region_code,c.campaign_id,
         n.item_id,i.name AS item_name,u.code AS unit_code,u.display_name AS unit_name,u.scale AS unit_scale,
         n.original_quantity::text AS original,n.requested_quantity::text AS requested,
         COALESCE(sum(cm.quantity-cm.released_quantity-cm.issued_quantity),0)::text AS committed_reserved,
         COALESCE(sum(cm.issued_quantity-cm.delivered_quantity-cm.returned_quantity-cm.lost_quantity),0)::text AS issued_unsettled,
         COALESCE(sum(cm.delivered_quantity),0)::text AS delivered,
         COALESCE(sum(cm.returned_quantity),0)::text AS returned,
         COALESCE(sum(cm.lost_quantity),0)::text AS lost,
         n.cancelled_remaining::text AS cancelled_remaining,n.status,n.version,n.created_at,
         to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         ${includeContributions ? ',contribution.contributions,contribution.contributions_more' : ''}
    FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
    JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
    LEFT JOIN commitment cm ON cm.relief_need_id=n.id
    ${includeContributions ? boardContributionsJoin : ''}`;
}

const boardContributionsJoin = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id',x.id,'warehouse_id',x.warehouse_id,'warehouse_name',x.warehouse_name,
             'quantity',x.quantity,'released_quantity',x.released_quantity,'issued_quantity',x.issued_quantity,
             'delivered_quantity',x.delivered_quantity,'returned_quantity',x.returned_quantity,
             'lost_quantity',x.lost_quantity,'created_by_user_id',x.created_by_user_id,'created_at',x.created_at
           ) ORDER BY x.created_at,x.id) FILTER (WHERE x.row_number <= 20),'[]'::jsonb) AS contributions,
           count(*) > 20 AS contributions_more
      FROM (
        SELECT cm.id,cm.warehouse_id,w.name AS warehouse_name,cm.quantity::text AS quantity,
               cm.released_quantity::text AS released_quantity,cm.issued_quantity::text AS issued_quantity,
               cm.delivered_quantity::text AS delivered_quantity,cm.returned_quantity::text AS returned_quantity,
               cm.lost_quantity::text AS lost_quantity,cm.created_by_user_id,cm.created_at,
               row_number() OVER (ORDER BY cm.created_at,cm.id) AS row_number
          FROM commitment cm JOIN warehouse w ON w.id=cm.warehouse_id
         WHERE cm.relief_need_id=n.id ORDER BY cm.created_at,cm.id LIMIT 21
      ) x
  ) contribution ON TRUE`;

function normalized(value: string | null, scale: number): string | null {
  return value === null ? null : decimalFromUnits(quantityUnits(value, scale), scale);
}

function contributionValue(row: ContributionRow, scale: number): Record<string, unknown> {
  const issued = quantityUnits(row.issued_quantity, scale);
  const settled = quantityUnits(row.delivered_quantity, scale) + quantityUnits(row.returned_quantity, scale) + quantityUnits(row.lost_quantity, scale);
  const released = quantityUnits(row.released_quantity, scale);
  const quantity = quantityUnits(row.quantity, scale);
  return {
    id: row.id,
    warehouse_id: row.warehouse_id,
    warehouse_name: row.warehouse_name,
    quantity: decimalFromUnits(quantity, scale),
    reserved_remaining: decimalFromUnits(quantity - released - issued, scale),
    issued_unsettled: decimalFromUnits(issued - settled, scale),
    delivered: decimalFromUnits(quantityUnits(row.delivered_quantity, scale), scale),
    returned: decimalFromUnits(quantityUnits(row.returned_quantity, scale), scale),
    lost: decimalFromUnits(quantityUnits(row.lost_quantity, scale), scale),
    created_by_user_id: row.created_by_user_id,
    created_at: new Date(row.created_at).toISOString(),
  };
}

function rowContributions(value: unknown, scale: number): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => contributionValue(row as ContributionRow, scale));
}

function needTotals(row: NeedQueryRow): Record<string, unknown> {
  const scale = Number(row.unit_scale);
  const requested = quantityUnits(row.requested, scale);
  const delivered = quantityUnits(row.delivered, scale);
  const outstanding = row.status === 'CANCELLED' ? 0n : requested - delivered;
  return {
    id: row.id,
    item: { id: row.item_id, name: row.item_name },
    unit: { code: row.unit_code, display_name: row.unit_name, scale },
    original: normalized(row.original, scale),
    requested: decimalFromUnits(requested, scale),
    committed_reserved: normalized(row.committed_reserved, scale),
    issued_unsettled: normalized(row.issued_unsettled, scale),
    delivered: decimalFromUnits(delivered, scale),
    returned: normalized(row.returned, scale),
    lost: normalized(row.lost, scale),
    outstanding: decimalFromUnits(outstanding, scale),
    cancelled_remaining: normalized(row.cancelled_remaining, scale),
    status: row.status,
  };
}

@Injectable()
export class NeedsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async list(query: NeedsListQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = filtersFor('logistics.needs', session.userId, session.grants, {
      request_id: query.request_id ?? null,
      work_cycle: query.work_cycle ?? null,
    });
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    if (cursor && !validTimeCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });

    const values: unknown[] = [];
    const conditions = [scopeSql(session.grants, values, 'c')];
    if (query.request_id) {
      values.push(query.request_id);
      conditions.push(`c.request_id=$${values.length}`);
    }
    if (query.work_cycle !== undefined) {
      values.push(query.work_cycle);
      conditions.push(`c.work_cycle=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(n.created_at,n.id)>($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `${needTotalsQuery()}
        WHERE ${conditions.join(' AND ')}
        GROUP BY n.id,c.id,i.id,u.code
        ORDER BY n.created_at,n.id LIMIT $${values.length}`,
      values,
    ) as NeedQueryRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...needTotals(row), cycle_id: row.cycle_id, request_id: row.request_id, work_cycle: Number(row.work_cycle),
        version: Number(row.version), created_at: new Date(row.created_at).toISOString(),
      })),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_created_at], last.id, filters) } : {}),
    };
  }

  async fulfillment(requestId: string, query: FulfillmentQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const values: unknown[] = [requestId];
    const conditions = [`c.request_id=$1`, scopeSql(session.grants, values, 'c')];
    if (query.work_cycle !== undefined) {
      values.push(query.work_cycle);
      conditions.push(`c.work_cycle=$${values.length}`);
    }
    const cycles = await this.dataSource.query(
      `SELECT c.id,c.request_id,c.work_cycle,c.organization_id,c.region_code,c.campaign_id,c.state
         FROM fulfillment_cycle c WHERE ${conditions.join(' AND ')}
        ORDER BY c.work_cycle DESC,c.id DESC LIMIT 1`,
      values,
    ) as CycleRow[];
    const cycle = cycles[0];
    if (!cycle) throw new AppError('NOT_FOUND', { status: 404 });

    const needs = await this.dataSource.query(
      `${needTotalsQuery(true)}
       WHERE n.cycle_id=$1
       GROUP BY n.id,c.id,i.id,u.code,contribution.contributions,contribution.contributions_more
       ORDER BY n.created_at,n.id`,
      [cycle.id],
    ) as NeedQueryRow[];
    return {
      needs: needs.map((row) => ({
        ...needTotals(row),
        contributions: {
          items: rowContributions(row.contributions, Number(row.unit_scale)),
          more: Boolean(row.contributions_more),
        },
      })),
      cycle_state: cycle.state,
      generated_at: new Date().toISOString(),
    };
  }

  async contributions(needId: string, query: NeedContributionsQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const accessValues: unknown[] = [needId];
    const accessScope = scopeSql(session.grants, accessValues, 'c');
    const access = await this.dataSource.query(
      `SELECT n.id,c.organization_id,c.region_code,c.campaign_id,u.scale AS unit_scale
         FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
         JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
        WHERE n.id=$1 AND ${accessScope}`,
      accessValues,
    ) as Array<{ id: string; organization_id: string; region_code: string | null; campaign_id: string | null; unit_scale: number | string }>;
    const need = access[0];
    if (!need) throw new AppError('NOT_FOUND', { status: 404 });

    const filters = filtersFor('logistics.needs.contributions', session.userId, session.grants, { need_id: needId });
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    if (cursor && !validTimeCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [needId];
    let cursorWhere = '';
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      cursorWhere = `AND (cm.created_at,cm.id)>($${values.length - 1}::timestamptz,$${values.length}::uuid)`;
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT cm.id,cm.warehouse_id,w.name AS warehouse_name,cm.quantity::text,
              cm.released_quantity::text,cm.issued_quantity::text,cm.delivered_quantity::text,
              cm.returned_quantity::text,cm.lost_quantity::text,cm.created_by_user_id,cm.created_at,
              to_char(cm.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM commitment cm JOIN warehouse w ON w.id=cm.warehouse_id
        WHERE cm.relief_need_id=$1 ${cursorWhere}
        ORDER BY cm.created_at,cm.id LIMIT $${values.length}`,
      values,
    ) as ContributionRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => contributionValue(row, Number(need.unit_scale))),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_created_at], last.id, filters) } : {}),
    };
  }
}
