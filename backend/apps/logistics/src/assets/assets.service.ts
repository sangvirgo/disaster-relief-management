import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { cleanText } from '../common/text';
import { AuthenticatedLogisticsSession, LogisticsSessionService } from '../auth/logistics-session.service';
import { CampaignWarehouseService } from '../campaign-warehouses/campaign-warehouses.service';
import { warehouseServiceArea, warehouseServiceAreaFromView, WarehouseServiceArea } from '../campaign-warehouses/campaign-warehouses.helpers';
import {
  assetAuditState, assetTables, assetView, findAsset, pointCoordinates, requireAssetManage,
  writeAssetAudit, AssetKind, AssetRow,
} from './assets.helpers';
import { CreateWarehouseDto, DeactivateAssetDto, PatchWarehouseDto } from './assets.dto';

type AssetRequest = Request & { idempotencyKey?: string };
type AssetPatchDto = PatchWarehouseDto;
type AssetCreateDto = CreateWarehouseDto;

function requestKey(request: AssetRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function assertCanManageRow(session: AuthenticatedLogisticsSession, _row: AssetRow): void {
  if (!session.grants.some((grant) => {
    try {
      requireAssetManage({ ...session, grants: [grant] });
      return true;
    } catch {
      return false;
    }
  })) throw new AppError('NOT_FOUND', { status: 404 });
}

function assertExpectedVersion(actual: number | string, expected: number): void {
  if (Number(actual) !== expected) throw new AppError('VERSION_CONFLICT', { status: 409 });
}

function validateAssetCreateText(dto: AssetCreateDto): void {
  cleanText(dto.name, 200);
  if (dto.address_note != null) cleanText(dto.address_note, 1_000);
}

function validatePatchText(dto: AssetPatchDto): void {
  if (dto.name !== undefined) cleanText(dto.name, 200);
  if (dto.address_note !== undefined && dto.address_note !== null) cleanText(dto.address_note, 1_000);
}

/** A warehouse service area needs its location and radius together: both absent, or both present. */
function assertWarehouseServiceArea(hasLocation: boolean, radius: number | null | undefined): void {
  if (hasLocation === (radius == null)) {
    throw new AppError('VALIDATION_FAILED', {
      status: 400,
      userMessage: 'Vui lòng nhập đồng thời vị trí và bán kính phục vụ của kho, hoặc để trống cả hai.',
      fieldErrors: { location: ['WAREHOUSE_SERVICE_AREA_PAIR_REQUIRED'], service_radius_m: ['WAREHOUSE_SERVICE_AREA_PAIR_REQUIRED'] },
    });
  }
}

function appendLocationUpdate(values: unknown[], sets: string[], location: CreateWarehouseDto['location']): void {
  const point = pointCoordinates(location);
  if (!point) {
    sets.push('location=NULL');
    return;
  }
  values.push(point[0], point[1]);
  sets.push(`location=ST_SetSRID(ST_MakePoint($${values.length + 1},$${values.length + 2}),4326)::geography`);
}

@Injectable()
export class AssetsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly campaignWarehouses: CampaignWarehouseService,
  ) {}

  async createWarehouse(dto: CreateWarehouseDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const result = await this.create('warehouse', dto, request);
    await this.notifyWarehouseChange(null, result);
    return result;
  }

  async patchWarehouse(id: string, dto: PatchWarehouseDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const before = await findAsset(this.dataSource, 'warehouse', id);
    const result = await this.patch('warehouse', id, dto, request);
    await this.notifyWarehouseChange(before ? warehouseServiceArea(before) : null, result);
    return result;
  }

  async deactivate(kind: AssetKind, id: string, dto: DeactivateAssetDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const before = await findAsset(this.dataSource, kind, id);
    const result = await this.deactivateAsset(kind, id, dto, request);
    if (before) await this.notifyWarehouseChange(warehouseServiceArea(before), result);
    return result;
  }

  /**
   * Re-evaluates campaign warehouse assignments after a real service-area change. Runs after the warehouse command has
   * committed; the trigger never throws, so a failure here cannot fail the warehouse command.
   */
  private async notifyWarehouseChange(before: WarehouseServiceArea | null, result: IdempotentResult<Record<string, unknown>>): Promise<void> {
    if (result.replay) return;
    await this.campaignWarehouses.onWarehouseChanged({ before, after: warehouseServiceAreaFromView(result.value) });
  }

  private async create(kind: AssetKind, dto: AssetCreateDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireAssetManage(session);
    validateAssetCreateText(dto);
    const coordinates = pointCoordinates(dto.location);
    assertWarehouseServiceArea(coordinates !== null, dto.service_radius_m);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: `logistics.${kind}.create`,
      key: requestKey(request),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, kind, dto }),
      execute: async (manager) => {
        const id = await this.insertAsset(manager, dto, coordinates);
        const row = await findAsset(manager, kind, id);
        if (!row) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await writeAssetAudit(manager, session.userId, `${kind.toUpperCase()}_CREATED`, kind, id, null, assetAuditState(row));
        return { status: 201, value: assetView(row, true), resource: { type: kind, id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== kind) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await findAsset(manager, kind, resource.id);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        return assetView(row, true);
      },
    });
  }

  private async insertAsset(
    manager: EntityManager,
    warehouse: AssetCreateDto,
    coordinates: [number, number] | null,
  ): Promise<string> {
    const values = [warehouse.name, warehouse.address_note ?? null,
      coordinates?.[0] ?? null, coordinates?.[1] ?? null, warehouse.location_public ?? false, warehouse.service_radius_m ?? null];
    const sql = `INSERT INTO warehouse (name,address_note,location,location_public,service_radius_m)
             VALUES ($1,$2,CASE WHEN $3::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($3,$4),4326)::geography END,$5,$6::integer)
             RETURNING id`;
    const rows = await manager.query(sql, values) as Array<{ id: string }>;
    const id = rows[0]?.id;
    if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
    return id;
  }

  private async patch(kind: AssetKind, id: string, dto: AssetPatchDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const current = await findAsset(this.dataSource, kind, id);
    if (!current) throw new AppError('NOT_FOUND', { status: 404 });
    assertCanManageRow(session, current);
    validatePatchText(dto);
    const mutableKeys = Object.keys(dto).filter((field) => field !== 'expected_version');
    if (mutableKeys.length === 0) throw new AppError('VALIDATION_FAILED', { status: 400 });

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: `logistics.${kind}.patch`,
      key: requestKey(request),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, kind, id, dto }),
      execute: async (manager) => {
        const row = await findAsset(manager, kind, id, { forUpdate: true });
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        assertExpectedVersion(row.version, dto.expected_version);
        const hasLocation = dto.location === undefined ? row.longitude !== null && row.longitude !== undefined : dto.location !== null;
        assertWarehouseServiceArea(hasLocation, dto.service_radius_m === undefined ? (row.service_radius_m == null ? null : Number(row.service_radius_m)) : dto.service_radius_m);
        const before = assetAuditState(row);
        const { sets, values } = this.patchAssignments(dto);
        if (sets.length === 0) throw new AppError('VALIDATION_FAILED', { status: 400 });
        values.unshift(id, dto.expected_version);
        const updated = await manager.query(
          `UPDATE ${assetTables[kind]} SET ${sets.join(',')},version=version+1 WHERE id=$1 AND version=$2 RETURNING id`,
          values,
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const next = await findAsset(manager, kind, id);
        if (!next) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await writeAssetAudit(manager, session.userId, `${kind.toUpperCase()}_UPDATED`, kind, id, before, assetAuditState(next));
        return { status: 200, value: assetView(next, true), resource: { type: kind, id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== kind) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await findAsset(manager, kind, resource.id);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        return assetView(row, true);
      },
    });
  }

  private patchAssignments(patch: AssetPatchDto): { sets: string[]; values: unknown[] } {
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column}=$${values.length + 2}`);
    };
    if (patch.name !== undefined) add('name', patch.name);
    if (patch.address_note !== undefined) add('address_note', patch.address_note);
    if (patch.location !== undefined) appendLocationUpdate(values, sets, patch.location);
    if (patch.location_public !== undefined) {
      if (typeof patch.location_public !== 'boolean') throw new AppError('VALIDATION_FAILED', { status: 400 });
      add('location_public', patch.location_public);
    }
    if (patch.service_radius_m !== undefined) add('service_radius_m', patch.service_radius_m);
    return { sets, values };
  }

  private async deactivateAsset(kind: AssetKind, id: string, dto: DeactivateAssetDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const current = await findAsset(this.dataSource, kind, id);
    if (!current) throw new AppError('NOT_FOUND', { status: 404 });
    assertCanManageRow(session, current);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: `logistics.${kind}.deactivate`,
      key: requestKey(request),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, kind, id, dto }),
      execute: async (manager) => {
        const row = await findAsset(manager, kind, id, { forUpdate: true });
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        assertExpectedVersion(row.version, dto.expected_version);
        if (row.status === 'ACTIVE') {
          const updated = await manager.query(
            `UPDATE ${assetTables[kind]} SET status='INACTIVE',version=version+1 WHERE id=$1 AND version=$2 RETURNING id`,
            [id, dto.expected_version],
          ) as Array<{ id: string }>;
          if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
          await writeAssetAudit(manager, session.userId, `${kind.toUpperCase()}_DEACTIVATED`, kind, id, assetAuditState(row), {
            ...assetAuditState(row), status: 'INACTIVE', version: Number(row.version) + 1,
          });
        }
        const next = await findAsset(manager, kind, id);
        if (!next) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return { status: 200, value: assetView(next, true), resource: { type: kind, id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== kind) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await findAsset(manager, kind, resource.id);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        return assetView(row, true);
      },
    });
  }
}
