import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { AdminRequest, IdentityAdminSupport } from '../admin/admin-security';
import { CreateRegionDto, DeactivateRegionDto, RegionListQueryDto } from './regions.dto';

interface RegionRow { code: string; name: string; status: 'ACTIVE' | 'INACTIVE'; version: number }

async function readRegion(manager: Pick<EntityManager, 'query'>, code: string): Promise<Record<string, unknown>> {
  const rows = await manager.query('SELECT code, name, status, version FROM region WHERE code = $1', [code]) as RegionRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return { ...rows[0], version: Number(rows[0].version) };
}

@Injectable()
export class RegionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly support: IdentityAdminSupport,
  ) {}

  async list(dto: RegionListQueryDto): Promise<Record<string, unknown>> {
    const filters = {};
    const cursor = dto.cursor ? decodeKeysetCursor(dto.cursor, filters) : null;
    if (cursor && (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string')) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    const where = cursor ? (values.push(cursor.sort[0], cursor.id), 'WHERE (code, code) > ($1, $2)') : '';
    values.push(Math.min(dto.limit ?? 50, 100) + 1);
    const rows = await this.dataSource.query(
      `SELECT code, name, status, version FROM region ${where} ORDER BY code ASC LIMIT $${values.length}`,
      values,
    ) as RegionRow[];
    const more = rows.length > (dto.limit ?? 50);
    const items = rows.slice(0, dto.limit ?? 50);
    const last = items.at(-1);
    return { items: items.map((item) => ({ ...item, version: Number(item.version) })), next_cursor: more && last ? encodeKeysetCursor([last.code], last.code, filters) : null };
  }

  async create(dto: CreateRegionDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.regions.create', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash(dto),
      execute: async (manager) => {
        const rows = await manager.query('INSERT INTO region (code, name) VALUES ($1, $2) RETURNING code', [dto.code, dto.name.trim()]) as Array<{ code: string }>;
        const value = await readRegion(manager, rows[0]!.code);
        await this.support.audit(manager, actorId, 'REGION_CREATED', 'region', dto.code, null, value, null);
        return { status: 201, value, resource: null };
      },
      replay: async (manager) => readRegion(manager, dto.code),
    });
  }

  async deactivate(code: string, dto: DeactivateRegionDto, actor: AdminRequest) {
    const actorId = actor.auth!.userId;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${actorId}`, command: 'identity.regions.deactivate', key: actor.idempotencyKey!,
      requestHash: canonicalRequestHash({ code, ...dto }),
      execute: async (manager) => {
        const rows = await manager.query('SELECT code, name, status, version FROM region WHERE code = $1 FOR UPDATE', [code]) as RegionRow[];
        const before = rows[0];
        if (!before) throw new AppError('NOT_FOUND', { status: 404 });
        if (Number(before.version) !== dto.expected_version) throw new AppError('VERSION_CONFLICT', { status: 409 });
        if (before.status !== 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const [updated] = await manager.query(
          `UPDATE region SET status = 'INACTIVE', version = version + 1
            WHERE code = $1 AND version = $2 RETURNING code, name, status, version`,
          [code, dto.expected_version],
        ) as [RegionRow[], number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const after = { ...updated[0], version: Number(updated[0].version) };
        await this.support.audit(manager, actorId, 'REGION_DEACTIVATED', 'region', code,
          { name: before.name, status: before.status, version: before.version }, after, dto.reason);
        return { status: 200, value: after, resource: null };
      },
      replay: async (manager) => readRegion(manager, code),
    });
  }
}
