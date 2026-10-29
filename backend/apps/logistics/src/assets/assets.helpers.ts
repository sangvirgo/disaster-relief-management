import { AppError } from '@c48/technical/errors/errors';
import { hasPermission } from '@c48/identity-contracts/permissions';
import type { AuthenticatedLogisticsSession } from '../auth/logistics-session.service';
import type { AssetPointDto } from './assets.dto';

export type AssetKind = 'warehouse' | 'relief_point' | 'vehicle';

export const assetTables: Record<AssetKind, string> = {
  warehouse: 'warehouse',
  relief_point: 'relief_point',
  vehicle: 'vehicle',
};

export interface AssetRow {
  id: string;
  organization_id: string;
  region_code: string;
  name?: string;
  identifier?: string;
  vehicle_type?: string;
  capacity?: string | null;
  capacity_unit?: string | null;
  address_note?: string | null;
  contact_note?: string | null;
  operating_note?: string | null;
  location_public?: boolean;
  longitude?: number | string | null;
  latitude?: number | string | null;
  status: 'ACTIVE' | 'INACTIVE';
  version: number | string;
  created_at: Date | string;
}

export function requireAssetManage(session: AuthenticatedLogisticsSession, organizationId: string, regionCode: string): void {
  if (!hasPermission(session.grants, 'ASSET_MANAGE', { organizationId, regionCode })) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}

export function requireAnyAssetManage(session: AuthenticatedLogisticsSession): void {
  const allowed = session.grants.some((grant) => {
    if (!grant.organization_id) return false;
    if (grant.scope_type === 'ORGANIZATION') {
      return hasPermission([grant], 'ASSET_MANAGE', { organizationId: grant.organization_id, regionCode: '__scope_check__' });
    }
    if (grant.scope_type === 'REGION' && grant.region_code) {
      return hasPermission([grant], 'ASSET_MANAGE', { organizationId: grant.organization_id, regionCode: grant.region_code });
    }
    return false;
  });
  if (!allowed) throw new AppError('FORBIDDEN', { status: 403 });
}

export function pointCoordinates(location: AssetPointDto | null | undefined): [number, number] | null {
  if (location === undefined || location === null) return null;
  const [longitude, latitude] = location.coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  return [longitude, latitude];
}

export function assetSelect(kind: AssetKind, includePrivate: boolean): string {
  const location = kind === 'vehicle'
    ? 'NULL::float8 AS longitude, NULL::float8 AS latitude'
    : 'ST_X(location::geometry)::float8 AS longitude, ST_Y(location::geometry)::float8 AS latitude';
  if (kind === 'warehouse') {
    return `SELECT id,organization_id,region_code,name,${includePrivate ? 'address_note' : 'NULL::text AS address_note'},
                   location_public,status,version,created_at,${location} FROM warehouse`;
  }
  if (kind === 'relief_point') {
    return `SELECT id,organization_id,region_code,name,${includePrivate ? 'contact_note,operating_note' : 'NULL::text AS contact_note,NULL::text AS operating_note'},
                   status,version,created_at,${location} FROM relief_point`;
  }
  return `SELECT id,organization_id,region_code,identifier,vehicle_type,capacity::text AS capacity,capacity_unit,
                 status,version,created_at,${location} FROM vehicle`;
}

export function assetView(kind: AssetKind, row: AssetRow, includePrivate: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: row.id,
    organization_id: row.organization_id,
    region_code: row.region_code,
    status: row.status,
    version: Number(row.version),
    created_at: new Date(row.created_at).toISOString(),
  };
  if (kind === 'warehouse') {
    result.name = row.name;
    result.location = row.longitude === null || row.longitude === undefined
      ? null
      : { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] };
    result.location_public = Boolean(row.location_public);
    if (includePrivate) result.address_note = row.address_note ?? null;
  } else if (kind === 'relief_point') {
    result.name = row.name;
    result.location = { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] };
    if (includePrivate) {
      result.contact_note = row.contact_note ?? null;
      result.operating_note = row.operating_note ?? null;
    }
  } else {
    result.identifier = row.identifier;
    result.vehicle_type = row.vehicle_type;
    result.capacity = row.capacity ?? null;
    result.capacity_unit = row.capacity_unit ?? null;
  }
  return result;
}

export function assetAuditState(kind: AssetKind, row: AssetRow): Record<string, unknown> {
  const state: Record<string, unknown> = {
    id: row.id,
    organization_id: row.organization_id,
    region_code: row.region_code,
    status: row.status,
    version: Number(row.version),
  };
  if (kind === 'warehouse') {
    state.name = row.name;
    state.location_public = Boolean(row.location_public);
    state.has_location = row.longitude !== null && row.longitude !== undefined;
  } else if (kind === 'relief_point') {
    state.name = row.name;
    state.has_location = row.longitude !== null && row.longitude !== undefined;
  } else {
    state.identifier = row.identifier;
    state.vehicle_type = row.vehicle_type;
    state.capacity = row.capacity ?? null;
    state.capacity_unit = row.capacity_unit ?? null;
  }
  return state;
}

export async function findAsset(
  manager: { query(sql: string, parameters?: unknown[]): Promise<unknown> },
  kind: AssetKind,
  id: string,
  options: { includePrivate?: boolean; forUpdate?: boolean } = {},
): Promise<AssetRow | undefined> {
  const rows = await manager.query(
    `${assetSelect(kind, options.includePrivate ?? true)} WHERE id=$1${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  ) as AssetRow[];
  return rows[0];
}

export async function writeAssetAudit(
  manager: { query(sql: string, parameters?: unknown[]): Promise<unknown> },
  actorId: string,
  action: string,
  kind: AssetKind,
  id: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [actorId, action, kind, id, before ? JSON.stringify(before) : null, JSON.stringify(after)],
  );
}
