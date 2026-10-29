import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { validateQuantity } from '../common/quantity';
import { cleanText } from '../common/text';
import { LogisticsIdentityService } from '../auth/logistics-identity.service';
import { AuthenticatedLogisticsSession, LogisticsSessionService } from '../auth/logistics-session.service';
import {
  assetAuditState, assetTables, assetView, findAsset, pointCoordinates, requireAssetManage,
  writeAssetAudit, AssetKind, AssetRow,
} from './assets.helpers';
import {
  CreateReliefPointDto, CreateVehicleDto, CreateWarehouseDto, DeactivateAssetDto,
  PatchReliefPointDto, PatchVehicleDto, PatchWarehouseDto,
} from './assets.dto';

type AssetRequest = Request & { idempotencyKey?: string };
type AssetPatchDto = PatchWarehouseDto | PatchReliefPointDto | PatchVehicleDto;
type AssetCreateDto = CreateWarehouseDto | CreateReliefPointDto | CreateVehicleDto;

function requestKey(request: AssetRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function assertCanManageRow(session: AuthenticatedLogisticsSession, row: AssetRow): void {
  if (!row.organization_id || !row.region_code || !session.grants.some((grant) => {
    try {
      requireAssetManage({ ...session, grants: [grant] }, row.organization_id, row.region_code);
      return true;
    } catch {
      return false;
    }
  })) throw new AppError('NOT_FOUND', { status: 404 });
}

function assertExpectedVersion(actual: number | string, expected: number): void {
  if (Number(actual) !== expected) throw new AppError('VERSION_CONFLICT', { status: 409 });
}

function validateAssetCreateText(kind: AssetKind, dto: AssetCreateDto): void {
  if (kind === 'vehicle') {
    const vehicle = dto as CreateVehicleDto;
    cleanText(vehicle.identifier, 100);
    cleanText(vehicle.vehicle_type, 80);
  } else {
    cleanText((dto as CreateWarehouseDto | CreateReliefPointDto).name, 200);
  }
  if (kind === 'warehouse' && (dto as CreateWarehouseDto).address_note != null) {
    cleanText((dto as CreateWarehouseDto).address_note!, 1_000);
  }
  if (kind === 'relief_point') {
    const point = dto as CreateReliefPointDto;
    if (point.contact_note != null) cleanText(point.contact_note, 1_000);
    if (point.operating_note != null) cleanText(point.operating_note, 1_000);
  }
}

function validatePatchText(kind: AssetKind, dto: AssetPatchDto): void {
  if (kind === 'vehicle') {
    const vehicle = dto as PatchVehicleDto;
    if (vehicle.identifier !== undefined) cleanText(vehicle.identifier, 100);
    if (vehicle.vehicle_type !== undefined) cleanText(vehicle.vehicle_type, 80);
  } else {
    const patch = dto as PatchWarehouseDto | PatchReliefPointDto;
    if (patch.name !== undefined) cleanText(patch.name, 200);
  }
  if (kind === 'warehouse' && (dto as PatchWarehouseDto).address_note !== undefined && (dto as PatchWarehouseDto).address_note !== null) {
    cleanText((dto as PatchWarehouseDto).address_note!, 1_000);
  }
  if (kind === 'relief_point') {
    const point = dto as PatchReliefPointDto;
    if (point.contact_note !== undefined && point.contact_note !== null) cleanText(point.contact_note, 1_000);
    if (point.operating_note !== undefined && point.operating_note !== null) cleanText(point.operating_note, 1_000);
  }
}

function validateCapacityPair(capacity: string | null | undefined, unit: string | null | undefined): void {
  if ((capacity == null) !== (unit == null)) throw new AppError('VALIDATION_FAILED', { status: 400 });
}

async function assertCapacityScale(manager: Pick<DataSource | EntityManager, 'query'>, capacity: string | null | undefined, unit: string | null | undefined): Promise<void> {
  validateCapacityPair(capacity, unit);
  if (capacity == null || unit == null) return;
  const rows = await manager.query('SELECT scale FROM unit WHERE code=$1', [unit]) as Array<{ scale: number | string }>;
  const row = rows[0];
  if (!row) throw new AppError('VALIDATION_FAILED', { status: 400 });
  validateQuantity(capacity, Number(row.scale));
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
    private readonly identity: LogisticsIdentityService,
  ) {}

  createWarehouse(dto: CreateWarehouseDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.create('warehouse', dto, request);
  }

  createReliefPoint(dto: CreateReliefPointDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.create('relief_point', dto, request);
  }

  createVehicle(dto: CreateVehicleDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.create('vehicle', dto, request);
  }

  patchWarehouse(id: string, dto: PatchWarehouseDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.patch('warehouse', id, dto, request);
  }

  patchReliefPoint(id: string, dto: PatchReliefPointDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.patch('relief_point', id, dto, request);
  }

  patchVehicle(id: string, dto: PatchVehicleDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.patch('vehicle', id, dto, request);
  }

  deactivate(kind: AssetKind, id: string, dto: DeactivateAssetDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.deactivateAsset(kind, id, dto, request);
  }

  private async create(kind: AssetKind, dto: AssetCreateDto, request: AssetRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireAssetManage(session, dto.organization_id, dto.region_code);
    validateAssetCreateText(kind, dto);
    await this.identity.assertActiveRegion(dto.region_code, session.identityHeaders);
    if (kind === 'vehicle') {
      const vehicle = dto as CreateVehicleDto;
      await assertCapacityScale(this.dataSource, vehicle.capacity, vehicle.capacity_unit);
    }
    const coordinates = kind === 'vehicle' ? null : pointCoordinates((dto as CreateWarehouseDto | CreateReliefPointDto).location);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: `logistics.${kind}.create`,
      key: requestKey(request),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, kind, dto }),
      ...(kind === 'vehicle' ? { databaseErrorMappings: { unique: { vehicle_identifier_uq: 'VEHICLE_IDENTIFIER_TAKEN' } } } : {}),
      execute: async (manager) => {
        const id = await this.insertAsset(manager, kind, dto, coordinates);
        const row = await findAsset(manager, kind, id);
        if (!row) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await writeAssetAudit(manager, session.userId, `${kind.toUpperCase()}_CREATED`, kind, id, null, assetAuditState(kind, row));
        return { status: 201, value: assetView(kind, row, true), resource: { type: kind, id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== kind) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await findAsset(manager, kind, resource.id);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        return assetView(kind, row, true);
      },
    });
  }

  private async insertAsset(
    manager: EntityManager,
    kind: AssetKind,
    dto: AssetCreateDto,
    coordinates: [number, number] | null,
  ): Promise<string> {
    let sql: string;
    let values: unknown[];
    if (kind === 'warehouse') {
      const warehouse = dto as CreateWarehouseDto;
      values = [dto.organization_id, dto.region_code, warehouse.name, warehouse.address_note ?? null,
        coordinates?.[0] ?? null, coordinates?.[1] ?? null, warehouse.location_public ?? false];
      sql = `INSERT INTO warehouse (organization_id,region_code,name,address_note,location,location_public)
             VALUES ($1,$2,$3,$4,CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$6),4326)::geography END,$7)
             RETURNING id`;
    } else if (kind === 'relief_point') {
      const point = dto as CreateReliefPointDto;
      if (!coordinates) throw new AppError('VALIDATION_FAILED', { status: 400 });
      values = [dto.organization_id, dto.region_code, point.name, point.contact_note ?? null, point.operating_note ?? null, coordinates[0], coordinates[1]];
      sql = `INSERT INTO relief_point (organization_id,region_code,name,contact_note,operating_note,location)
             VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography) RETURNING id`;
    } else {
      const vehicle = dto as CreateVehicleDto;
      values = [dto.organization_id, dto.region_code, vehicle.identifier, vehicle.vehicle_type, vehicle.capacity ?? null, vehicle.capacity_unit ?? null];
      sql = `INSERT INTO vehicle (organization_id,region_code,identifier,vehicle_type,capacity,capacity_unit)
             VALUES ($1,$2,$3,$4,$5::numeric,$6) RETURNING id`;
    }
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
    validatePatchText(kind, dto);
    const mutableKeys = Object.keys(dto).filter((field) => field !== 'expected_version');
    if (mutableKeys.length === 0) throw new AppError('VALIDATION_FAILED', { status: 400 });

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: `logistics.${kind}.patch`,
      key: requestKey(request),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, kind, id, dto }),
      ...(kind === 'vehicle' ? { databaseErrorMappings: { unique: { vehicle_identifier_uq: 'VEHICLE_IDENTIFIER_TAKEN' } } } : {}),
      execute: async (manager) => {
        const row = await findAsset(manager, kind, id, { forUpdate: true });
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        assertExpectedVersion(row.version, dto.expected_version);
        if (kind === 'vehicle') await this.validateEffectiveVehicle(manager, row, dto as PatchVehicleDto);
        const before = assetAuditState(kind, row);
        const { sets, values } = this.patchAssignments(kind, dto);
        if (sets.length === 0) throw new AppError('VALIDATION_FAILED', { status: 400 });
        values.unshift(id, dto.expected_version);
        const updated = await manager.query(
          `UPDATE ${assetTables[kind]} SET ${sets.join(',')},version=version+1 WHERE id=$1 AND version=$2 RETURNING id`,
          values,
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const next = await findAsset(manager, kind, id);
        if (!next) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await writeAssetAudit(manager, session.userId, `${kind.toUpperCase()}_UPDATED`, kind, id, before, assetAuditState(kind, next));
        return { status: 200, value: assetView(kind, next, true), resource: { type: kind, id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== kind) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await findAsset(manager, kind, resource.id);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        return assetView(kind, row, true);
      },
    });
  }

  private patchAssignments(kind: AssetKind, dto: AssetPatchDto): { sets: string[]; values: unknown[] } {
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column}=$${values.length + 2}`);
    };
    if (kind === 'warehouse') {
      const patch = dto as PatchWarehouseDto;
      if (patch.name !== undefined) add('name', patch.name);
      if (patch.address_note !== undefined) add('address_note', patch.address_note);
      if (patch.location !== undefined) appendLocationUpdate(values, sets, patch.location);
      if (patch.location_public !== undefined) {
        if (typeof patch.location_public !== 'boolean') throw new AppError('VALIDATION_FAILED', { status: 400 });
        add('location_public', patch.location_public);
      }
    } else if (kind === 'relief_point') {
      const patch = dto as PatchReliefPointDto;
      if (patch.name !== undefined) add('name', patch.name);
      if (patch.contact_note !== undefined) add('contact_note', patch.contact_note);
      if (patch.operating_note !== undefined) add('operating_note', patch.operating_note);
      if (patch.location !== undefined) {
        const point = pointCoordinates(patch.location);
        if (!point) throw new AppError('VALIDATION_FAILED', { status: 400 });
        values.push(point[0], point[1]);
        sets.push(`location=ST_SetSRID(ST_MakePoint($${values.length + 1},$${values.length + 2}),4326)::geography`);
      }
    } else {
      const patch = dto as PatchVehicleDto;
      if (patch.identifier !== undefined) add('identifier', patch.identifier);
      if (patch.vehicle_type !== undefined) add('vehicle_type', patch.vehicle_type);
      if (patch.capacity !== undefined) add('capacity', patch.capacity);
      if (patch.capacity_unit !== undefined) add('capacity_unit', patch.capacity_unit);
    }
    return { sets, values };
  }

  private async validateEffectiveVehicle(manager: EntityManager, current: AssetRow, patch: PatchVehicleDto): Promise<void> {
    const capacity = patch.capacity === undefined ? current.capacity : patch.capacity;
    const unit = patch.capacity_unit === undefined ? current.capacity_unit : patch.capacity_unit;
    await assertCapacityScale(manager, capacity, unit);
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
          await writeAssetAudit(manager, session.userId, `${kind.toUpperCase()}_DEACTIVATED`, kind, id, assetAuditState(kind, row), {
            ...assetAuditState(kind, row), status: 'INACTIVE', version: Number(row.version) + 1,
          });
        }
        const next = await findAsset(manager, kind, id);
        if (!next) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return { status: 200, value: assetView(kind, next, true), resource: { type: kind, id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== kind) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await findAsset(manager, kind, resource.id);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        assertCanManageRow(session, row);
        return assetView(kind, row, true);
      },
    });
  }
}
