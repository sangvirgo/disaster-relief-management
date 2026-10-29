import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { hasWarehouseScope, stockWarehouseScopeSql } from '../stock/stock.scope';
import { DistributionListQueryDto } from './distributions.dto';
import type { DistributionHandoffKind } from './distributions.helpers';
import { distributionView, loadDistribution, loadDistributions, readDistributionLines } from './distributions.read';
import { requireHandoffReadPermission } from './handoff-permissions.helpers';
import { readHandoffView } from './handoffs.read';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function filtersFor(query: DistributionListQueryDto, userId: string, grants: unknown[]): Record<string, unknown> {
  return { route: 'logistics.distributions', user_id: userId, grants, status: query.status ?? null };
}

function validCursor(cursor: ReturnType<typeof decodeKeysetCursor>): boolean {
  if (cursor.sort.length !== 2 || typeof cursor.sort[0] !== 'string' || cursor.sort[1] !== cursor.id || !uuidPattern.test(cursor.id)) return false;
  const date = new Date(cursor.sort[0]);
  return Number.isFinite(date.getTime()) && date.toISOString() === cursor.sort[0];
}

function requireReadScope(grants: Parameters<typeof hasWarehouseScope>[0], organizationId: string, regionCode: string): void {
  if (!hasWarehouseScope(grants, organizationId, regionCode)) throw new AppError('NOT_FOUND', { status: 404 });
}

@Injectable()
export class DistributionQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async list(query: DistributionListQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = filtersFor(query, session.userId, session.grants);
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });

    const values: unknown[] = [];
    const conditions = [stockWarehouseScopeSql(session.grants, values, 'w')];
    if (query.status) {
      values.push(query.status);
      conditions.push(`d.status=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(d.created_at,d.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT d.id,d.created_at FROM distribution d JOIN warehouse w ON w.id=d.warehouse_id
        WHERE ${conditions.join(' AND ')} ORDER BY d.created_at DESC,d.id DESC LIMIT $${values.length}`,
      values,
    ) as Array<{ id: string; created_at: Date | string }>;
    const pageRows = rows.slice(0, limit);
    const ids = pageRows.map((row) => row.id);
    const [distributions, groupedLines] = await Promise.all([
      loadDistributions(this.dataSource, ids),
      readDistributionLines(this.dataSource, ids),
    ]);
    const byId = new Map(distributions.map((row) => [row.id, row]));
    const last = pageRows.at(-1);

    return {
      items: ids.flatMap((id) => {
        const distribution = byId.get(id);
        return distribution ? [distributionView(distribution, groupedLines.get(id) ?? [])] : [];
      }),
      more: rows.length > limit,
      ...(rows.length > limit && last
        ? { cursor: encodeKeysetCursor([new Date(last.created_at).toISOString(), last.id], last.id, filters) }
        : {}),
    };
  }

  async detail(id: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const distribution = await loadDistribution(this.dataSource, id);
    requireReadScope(session.grants, distribution.organization_id, distribution.warehouse_region_code);
    const groupedLines = await readDistributionLines(this.dataSource, [id]);
    return distributionView(distribution, groupedLines.get(id) ?? []);
  }

  async handoffDetail(distributionId: string, handoffId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const distribution = await loadDistribution(this.dataSource, distributionId);
    requireReadScope(session.grants, distribution.organization_id, distribution.warehouse_region_code);
    const handoffs = await this.dataSource.query(
      'SELECT h.handoff_kind FROM handoff_record h WHERE h.distribution_id=$1 AND h.id=$2',
      [distributionId, handoffId],
    ) as Array<{ handoff_kind: DistributionHandoffKind }>;
    const handoffKindRow = handoffs[0];
    if (!handoffKindRow) throw new AppError('NOT_FOUND', { status: 404 });
    requireHandoffReadPermission(session.grants, handoffKindRow.handoff_kind, distribution);

    const [handoff, evidenceRows] = await Promise.all([
      readHandoffView(this.dataSource, distributionId, handoffId),
      this.dataSource.query(
        `SELECT a.id,a.state,a.size_bytes,a.detected_mime,a.created_at
           FROM logistics_attachment a
          WHERE a.handoff_id=$1 AND a.state='READY'
            AND EXISTS (SELECT 1 FROM handoff_record h WHERE h.id=$1 AND h.distribution_id=$2)
          ORDER BY a.created_at,a.id`,
        [handoffId, distributionId],
      ) as Promise<Array<{
        id: string;
        state: 'READY';
        size_bytes: number | string;
        detected_mime: string;
        created_at: Date | string;
      }>>,
    ]);

    return {
      ...handoff,
      evidence: evidenceRows.map((row) => ({
        id: row.id,
        state: row.state,
        size_bytes: Number(row.size_bytes),
        detected_mime: row.detected_mime,
        created_at: new Date(row.created_at).toISOString(),
      })),
    };
  }
}
