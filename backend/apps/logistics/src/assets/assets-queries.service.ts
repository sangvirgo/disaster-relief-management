import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { hasPermission } from '@c48/identity-contracts/permissions';
import type { Grant } from '@c48/identity-contracts/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { AssetPageQueryDto } from './assets.dto';
import {
  assetSelect, assetView, AssetKind, AssetRow, findAsset, requireAnyAssetManage,
} from './assets.helpers';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function filtersFor(kind: AssetKind, userId: string, grants: unknown[], status?: string): Record<string, unknown> {
  return { route: `logistics.${kind}`, user_id: userId, grants, status: status ?? null };
}

function scopeWhere(grants: readonly Grant[], _values: unknown[]): string {
  if (!hasPermission(grants, 'ASSET_MANAGE', { campaignId: null })) throw new AppError('FORBIDDEN', { status: 403 });
  return 'TRUE';
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
    if (!row || !hasPermission(session.grants, 'ASSET_MANAGE', { campaignId: null })) throw new AppError('NOT_FOUND', { status: 404 });
    return assetView('relief_point', row, true);
  }
}
