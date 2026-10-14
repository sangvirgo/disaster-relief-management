import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { AuthenticatedLogisticsSession, LogisticsSessionService } from '../auth/logistics-session.service';
import { hasCatalogManageGrant } from './catalog.helpers';
import { CatalogPageQueryDto, CreateItemDto, CreateItemTypeDto, CreateUnitDto, DeactivateItemDto, ItemPageQueryDto } from './catalog.dto';

type Queryable = Pick<DataSource | EntityManager, 'query'>;
type LogisticsRequest = Request & { idempotencyKey?: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function validItemCursor(cursor: ReturnType<typeof decodeKeysetCursor>): boolean {
  if (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string' || !uuidPattern.test(cursor.id)) return false;
  const date = new Date(cursor.sort[0]);
  return Number.isFinite(date.getTime()) && date.toISOString() === cursor.sort[0];
}

interface ItemRow {
  id: string;
  item_type_code: string;
  item_type_name: string;
  unit_code: string;
  unit_name: string;
  scale: number;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  created_at: Date | string;
}

function key(request: LogisticsRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function requireCatalogManage(session: AuthenticatedLogisticsSession): void {
  if (!hasCatalogManageGrant(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
}

function cleanText(value: string, maxLength: number): string {
  if (!value || value.length > maxLength || !value.trim() || value !== value.normalize('NFC')) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  return value;
}

function publicItem(row: ItemRow): Record<string, unknown> {
  return {
    id: row.id,
    item_type: { code: row.item_type_code, display_name: row.item_type_name },
    unit: { code: row.unit_code, display_name: row.unit_name, scale: Number(row.scale) },
    name: row.name,
    status: row.status,
    version: Number(row.version),
    created_at: new Date(row.created_at).toISOString(),
  };
}

async function readCode(manager: Queryable, table: 'item_type' | 'unit', code: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    table === 'unit'
      ? 'SELECT code, display_name, scale FROM unit WHERE code = $1'
      : 'SELECT code, display_name FROM item_type WHERE code = $1',
    [code],
  ) as Array<Record<string, unknown>>;
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

async function readItem(manager: Queryable, itemId: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT i.id, i.item_type_code, t.display_name AS item_type_name, i.unit_code,
            u.display_name AS unit_name, u.scale, i.name, i.status, i.version, i.created_at
       FROM item i JOIN item_type t ON t.code = i.item_type_code JOIN unit u ON u.code = i.unit_code
      WHERE i.id = $1`,
    [itemId],
  ) as ItemRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return publicItem(rows[0]);
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async itemTypes(query: CatalogPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    await this.sessions.require(request);
    return this.listCodes('item_type', query);
  }

  async units(query: CatalogPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    await this.sessions.require(request);
    return this.listCodes('unit', query);
  }

  async items(query: ItemPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    await this.sessions.require(request);
    const filters = { type: query.type ?? null, status: query.status ?? null, query: query.query?.trim().toLocaleLowerCase('en-US') || null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validItemCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });

    const values: unknown[] = [];
    const conditions: string[] = [];
    const add = (clause: (index: number) => string, value: unknown) => {
      values.push(value);
      conditions.push(clause(values.length));
    };
    if (query.type) add((index) => `i.item_type_code = $${index}`, query.type);
    if (query.status) add((index) => `i.status = $${index}`, query.status);
    if (filters.query) {
      const pattern = filters.query.replace(/[\\%_]/gu, '\\$&') + '%';
      add((index) => `lower(i.name) LIKE $${index} ESCAPE E'\\\\'`, pattern);
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(i.created_at, i.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    const limit = Math.min(query.limit ?? 50, 100);
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT i.id, i.item_type_code, t.display_name AS item_type_name, i.unit_code,
              u.display_name AS unit_name, u.scale, i.name, i.status, i.version, i.created_at
         FROM item i JOIN item_type t ON t.code = i.item_type_code JOIN unit u ON u.code = i.unit_code
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY i.created_at DESC, i.id DESC LIMIT $${values.length}`,
      values,
    ) as ItemRow[];
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(publicItem),
      next_cursor: rows.length > limit && last ? encodeKeysetCursor([new Date(last.created_at).toISOString()], last.id, filters) : null,
    };
  }

  async createItemType(dto: CreateItemTypeDto, request: LogisticsRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireCatalogManage(session);
    const displayName = cleanText(dto.display_name, 100);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.item-types.create',
      key: key(request),
      requestHash: canonicalRequestHash(dto),
      databaseErrorMappings: { unique: { item_type_pkey: 'STATE_TRANSITION_INVALID' } },
      execute: async (manager) => {
        await manager.query('INSERT INTO item_type (code, display_name) VALUES ($1, $2)', [dto.code, displayName]);
        return { status: 201, value: await readCode(manager, 'item_type', dto.code), resource: null };
      },
      replay: (manager) => readCode(manager, 'item_type', dto.code),
    });
  }

  async createUnit(dto: CreateUnitDto, request: LogisticsRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireCatalogManage(session);
    const displayName = cleanText(dto.display_name, 100);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.units.create',
      key: key(request),
      requestHash: canonicalRequestHash(dto),
      databaseErrorMappings: { unique: { unit_pkey: 'STATE_TRANSITION_INVALID' } },
      execute: async (manager) => {
        await manager.query('INSERT INTO unit (code, display_name, scale) VALUES ($1, $2, $3)', [dto.code, displayName, dto.scale]);
        return { status: 201, value: await readCode(manager, 'unit', dto.code), resource: null };
      },
      replay: (manager) => readCode(manager, 'unit', dto.code),
    });
  }

  async createItem(dto: CreateItemDto, request: LogisticsRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireCatalogManage(session);
    const name = cleanText(dto.name, 200);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.items.create',
      key: key(request),
      requestHash: canonicalRequestHash(dto),
      databaseErrorMappings: { unique: { item_name_unit_uq: 'ITEM_NAME_TAKEN' } },
      execute: async (manager) => {
        const rows = await manager.query(
          `INSERT INTO item (item_type_code, unit_code, name) VALUES ($1, $2, $3) RETURNING id`,
          [dto.item_type_code, dto.unit_code, name],
        ) as Array<{ id: string }>;
        return { status: 201, value: await readItem(manager, rows[0]!.id), resource: { type: 'item', id: rows[0]!.id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'item') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return readItem(manager, resource.id);
      },
    });
  }

  async deactivateItem(itemId: string, dto: DeactivateItemDto, request: LogisticsRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireCatalogManage(session);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.items.deactivate',
      key: key(request),
      requestHash: canonicalRequestHash({ item_id: itemId, ...dto }),
      execute: async (manager) => {
        const rows = await manager.query('SELECT status, version FROM item WHERE id = $1 FOR UPDATE', [itemId]) as Array<{ status: string; version: number }>;
        const before = rows[0];
        if (!before) throw new AppError('NOT_FOUND', { status: 404 });
        if (Number(before.version) !== dto.expected_version) throw new AppError('VERSION_CONFLICT', { status: 409 });
        if (before.status === 'ACTIVE') {
          const [updated] = await manager.query(
            `UPDATE item SET status = 'INACTIVE', version = version + 1 WHERE id = $1 AND version = $2 RETURNING id`,
            [itemId, dto.expected_version],
          ) as [Array<{ id: string }>, number];
          if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        }
        return { status: 200, value: await readItem(manager, itemId), resource: { type: 'item', id: itemId } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'item') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return readItem(manager, resource.id);
      },
    });
  }

  private async listCodes(table: 'item_type' | 'unit', query: CatalogPageQueryDto): Promise<Record<string, unknown>> {
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, {}) : null;
    if (cursor && (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string')) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    const where = cursor ? (values.push(cursor.sort[0], cursor.id), 'WHERE (code, code) > ($1, $2)') : '';
    const limit = Math.min(query.limit ?? 50, 100);
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT code, display_name${table === 'unit' ? ', scale' : ''} FROM ${table} ${where} ORDER BY code ASC LIMIT $${values.length}`,
      values,
    ) as Array<{ code: string; display_name: string; scale?: number }>;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      next_cursor: rows.length > limit && last ? encodeKeysetCursor([last.code], last.code, {}) : null,
    };
  }
}
