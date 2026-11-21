import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { AuthenticatedLogisticsSession, LogisticsSessionService } from '../auth/logistics-session.service';
import { hasCatalogManageGrant } from './catalog.helpers';
import { CatalogPageQueryDto, CreateItemDto, CreateItemTypeDto, CreateUnitDto, DeactivateItemDto, ItemPageQueryDto, UpdateItemAliasesDto } from './catalog.dto';
import { cleanItemAliases } from './item-aliases';
import { requireIdempotencyKey as key } from '@c48/technical/http/response-headers';

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
  aliases: string[];
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  created_at: Date | string;
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
    aliases: row.aliases ?? [],
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
            u.display_name AS unit_name, u.scale, i.name, i.status, i.version, i.created_at, i.aliases
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
              u.display_name AS unit_name, u.scale, i.name, i.status, i.version, i.created_at, i.aliases
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
        const aliases = cleanItemAliases(dto.aliases ?? []);
        const rows = await manager.query(
          `INSERT INTO item (item_type_code, unit_code, name, aliases) VALUES ($1, $2, $3, $4::text[]) RETURNING id`,
          [dto.item_type_code, dto.unit_code, name, aliases],
        ) as Array<{ id: string }>;
        return { status: 201, value: await readItem(manager, rows[0]!.id), resource: { type: 'item', id: rows[0]!.id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'item') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return readItem(manager, resource.id);
      },
    });
  }

  /** Corrects catalog text without changing the unit/type used by stock history. */
  async updateItemAliases(itemId: string, dto: UpdateItemAliasesDto, request: LogisticsRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireCatalogManage(session);
    if ((dto.name === undefined && dto.aliases === undefined) || dto.name === null || dto.aliases === null) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const name = dto.name === undefined ? undefined : cleanText(dto.name, 200);
    const aliases = dto.aliases === undefined ? undefined : cleanItemAliases(dto.aliases);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.items.aliases',
      key: key(request),
      requestHash: canonicalRequestHash({ item_id: itemId, expected_version: dto.expected_version, name, aliases }),
      databaseErrorMappings: { unique: { item_name_unit_uq: 'ITEM_NAME_TAKEN' } },
      execute: async (manager) => {
        const rows = await manager.query('SELECT version FROM item WHERE id = $1 FOR UPDATE', [itemId]) as Array<{ version: number }>;
        const before = rows[0];
        if (!before) throw new AppError('NOT_FOUND', { status: 404 });
        if (Number(before.version) !== dto.expected_version) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const [updated] = await manager.query(
          name === undefined
            ? `UPDATE item SET aliases = $2::text[], version = version + 1 WHERE id = $1 AND version = $3 RETURNING id`
            : `UPDATE item SET name = $2, aliases = COALESCE($3::text[], aliases), version = version + 1 WHERE id = $1 AND version = $4 RETURNING id`,
          name === undefined ? [itemId, aliases, dto.expected_version] : [itemId, name, aliases ?? null, dto.expected_version],
        ) as [Array<{ id: string }>, number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        return { status: 200, value: await readItem(manager, itemId), resource: { type: 'item', id: itemId } };
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

  /** Hard deletion is permitted only while no business row references the item. */
  async deleteItem(itemId: string, dto: DeactivateItemDto, request: LogisticsRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireCatalogManage(session);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.items.delete',
      key: key(request),
      requestHash: canonicalRequestHash({ item_id: itemId, ...dto }),
      execute: async (manager) => {
        const rows = await manager.query('SELECT version FROM item WHERE id = $1 FOR UPDATE', [itemId]) as Array<{ version: number }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        if (Number(rows[0].version) !== dto.expected_version) throw new AppError('VERSION_CONFLICT', { status: 409 });
        try {
          await manager.query('DELETE FROM item WHERE id = $1', [itemId]);
        } catch (cause) {
          if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23503') {
            throw new AppError('ITEM_IN_USE', { status: 409, cause });
          }
          throw cause;
        }
        return { status: 200, value: { id: itemId, deleted: true }, resource: null };
      },
      replay: async () => ({ id: itemId, deleted: true }),
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
