import { AppError } from '@c48/technical/errors/errors';
import { hasPermission } from '@c48/identity-contracts/permissions';
import type { AuthenticatedLogisticsSession } from '../auth/logistics-session.service';
import type { AssetPointDto } from './assets.dto';

export type AssetKind = 'warehouse';

export const assetTables: Record<AssetKind, string> = {
  warehouse: 'warehouse',
};

export interface AssetRow {
  id: string;
  name?: string;
  address_note?: string | null;
  location_public?: boolean;
  service_radius_m?: number | string | null;
  longitude?: number | string | null;
  latitude?: number | string | null;
  status: 'ACTIVE' | 'INACTIVE';
  version: number | string;
  created_at: Date | string;
}

export function requireAssetManage(session: AuthenticatedLogisticsSession): void {
  if (!hasPermission(session.grants, 'ASSET_MANAGE', { campaignId: null })) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}

export function requireAnyAssetManage(session: AuthenticatedLogisticsSession): void {
  const allowed = hasPermission(session.grants, 'ASSET_MANAGE', { campaignId: null });
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

export function assetSelect(includePrivate: boolean): string {
  const location = 'ST_X(location::geometry)::float8 AS longitude, ST_Y(location::geometry)::float8 AS latitude';
  return `SELECT id,name,${includePrivate ? 'address_note' : 'NULL::text AS address_note'},
                 location_public,service_radius_m,status,version,created_at,${location} FROM warehouse`;
}

export function assetView(row: AssetRow, includePrivate: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: row.id,
    status: row.status,
    version: Number(row.version),
    created_at: new Date(row.created_at).toISOString(),
    name: row.name,
    location: row.longitude === null || row.longitude === undefined
      ? null
      : { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] },
    location_public: Boolean(row.location_public),
    service_radius_m: row.service_radius_m === null || row.service_radius_m === undefined ? null : Number(row.service_radius_m),
  };
  if (includePrivate) result.address_note = row.address_note ?? null;
  return result;
}

export function assetAuditState(row: AssetRow): Record<string, unknown> {
  return {
    id: row.id,
    status: row.status,
    version: Number(row.version),
    name: row.name,
    location_public: Boolean(row.location_public),
    has_location: row.longitude !== null && row.longitude !== undefined,
    service_radius_m: row.service_radius_m === null || row.service_radius_m === undefined ? null : Number(row.service_radius_m),
  };
}

export async function findAsset(
  manager: { query(sql: string, parameters?: unknown[]): Promise<unknown> },
  kind: AssetKind,
  id: string,
  options: { includePrivate?: boolean; forUpdate?: boolean } = {},
): Promise<AssetRow | undefined> {
  const rows = await manager.query(
    `${assetSelect(options.includePrivate ?? true)} WHERE id=$1${options.forUpdate ? ' FOR UPDATE' : ''}`,
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
