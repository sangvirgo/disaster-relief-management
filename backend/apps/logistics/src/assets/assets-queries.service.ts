import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { hasPermission, ROLE_PERMISSIONS } from '../../../../packages/technical/src/security/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { AssetPageQueryDto } from './assets.dto';
import {
  assetSelect, assetView, AssetKind, AssetRow, findAsset, requireAnyAssetManage,
} from './assets.helpers';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function filtersFor(kind: AssetKind, userId: string, grants: unknown[], status?: string): Record<string, unknown> {
  return { route: `logistics.${kind}`, user_id: userId, grants, status: status ?? null };
}

function scopeWhere(grants: readonly { role_code: keyof typeof ROLE_PERMISSIONS; scope_type: string; organization_id: string | null; region_code?: string | null; campaign_id?: string | null }[], values: unknown[]): string {
  const branches: string[] = [];
  for (const grant of grants) {
    const permissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
    if (!permissions.includes('ASSET_MANAGE') || !grant.organization_id) continue;
    if (grant.scope_type === 'ORGANIZATION' && !grant.region_code && !grant.campaign_id) {
      values.push(grant.organization_id);
      branches.push(`a.organization_id=$${values.length}`);
    } else if (grant.scope_type === 'REGION' && grant.region_code && !grant.campaign_id) {
      values.push(grant.organization_id, grant.region_code);
      branches.push(`(a.organization_id=$${values.length - 1} AND a.region_code=$${values.length})`);
    }
  }
  if (branches.length === 0) throw new AppError('FORBIDDEN', { status: 403 });
  return `(${branches.join(' OR ')})`;
}

@Injectable()
export class AssetsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async list(kind: AssetKind, query: AssetPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireAnyAssetManage(session);
    const filters = filtersFor(kind, session.userId, session.grants, query.status);
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    if (cursor && (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string' || !uuidPattern.test(cursor.id) || cursor.sort[0] !== cursor.id)) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }

    const values: unknown[] = [];
    const conditions = [scopeWhere(session.grants, values)];
    if (query.status) {
      values.push(query.status);
      conditions.push(`a.status=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(a.id,a.id)>($${values.length - 1}::uuid,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `${assetSelect(kind, false).replace(`FROM ${kind === 'relief_point' ? 'relief_point' : kind}`, `FROM ${kind === 'relief_point' ? 'relief_point' : kind} a`)}
       WHERE ${conditions.join(' AND ')} ORDER BY a.id ASC LIMIT $${values.length}`,
      values,
    ) as AssetRow[];
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map((row) => assetView(kind, row, false)),
      more: rows.length > limit,
      ...(rows.length > limit && last ? { cursor: encodeKeysetCursor([last.id], last.id, filters) } : {}),
    };
  }

  async reliefPointDetail(id: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireAnyAssetManage(session);
    const row = await findAsset(this.dataSource, 'relief_point', id);
    if (!row || !session.grants.some((grant) => hasPermission([grant], 'ASSET_MANAGE', {
      organizationId: row.organization_id, regionCode: row.region_code,
    }))) throw new AppError('NOT_FOUND', { status: 404 });
    return assetView('relief_point', row, true);
  }
}
