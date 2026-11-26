import { AppError } from '@c48/technical/errors/errors';
import { hasPermission, Permission } from '@c48/identity-contracts/permissions';
import type { AuthenticatedLogisticsSession } from '../auth/logistics-session.service';

/** Largest campaign radius accepted by Response (300 km). */
export const MAX_CAMPAIGN_RADIUS_M = 300_000;
/** Largest warehouse service radius (200 km, migration CHECK) plus largest campaign radius; used only as an index prefilter. */
export const MAX_SERVICE_REACH_M = 500_000;

export type AssignmentRole = 'PRIMARY' | 'BACKUP';
export type AssignmentSource = 'AUTO' | 'MANUAL';
export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type AssignmentFlag = 'NO_SERVING_WAREHOUSE' | 'MANUAL_PRIMARY_INELIGIBLE' | 'CAMPAIGN_AREA_MISSING';

export interface CampaignCenter {
  lat: number;
  lng: number;
}

/** Campaign area as read from Response (or from the local snapshot). */
export interface CampaignArea {
  status: CampaignStatus;
  center: CampaignCenter | null;
  radius_m: number | null;
}

/** An eligible warehouse for one campaign, produced by the eligibility query. */
export interface CandidateRow {
  warehouse_id: string;
  name: string;
  distance_m: number;
  open_needed_items: number;
  needed_items_in_stock: number;
  open_supply_requests: number;
}

/** A stored campaign_warehouse row. */
export interface StoredAssignment {
  warehouse_id: string;
  role: AssignmentRole;
  source: AssignmentSource;
  distance_m: number | null;
  version: number;
}

/** The desired rows for one campaign after an evaluation. */
export interface DesiredAssignment {
  warehouse_id: string;
  role: AssignmentRole;
  source: AssignmentSource;
  distance_m: number | null;
}

export interface AssignmentPlanInput {
  candidates: readonly CandidateRow[];
  stored: readonly StoredAssignment[];
  /** Re-rank the AUTO primary even when it is still eligible (warehouse or area changed, manager request). */
  rerank: boolean;
  /** Treat a MANUAL primary as AUTO again (manager asked to clear the manual choice). */
  clearManual: boolean;
  /** Manager override: this warehouse becomes the MANUAL primary. The caller checks eligibility. */
  override?: string | undefined;
}

export interface AssignmentPlan {
  primaryId: string | null;
  primarySource: AssignmentSource | null;
  rows: DesiredAssignment[];
}

export interface WarehouseServiceArea {
  warehouse_id: string;
  status: 'ACTIVE' | 'INACTIVE';
  location: { lat: number; lng: number } | null;
  radius_m: number | null;
}

export interface WarehouseChange {
  before: WarehouseServiceArea | null;
  after: WarehouseServiceArea;
}

/** Ranking: stock for the campaign's open needs first, then lower load, shorter distance and the smallest id. */
export function rankCandidates(candidates: readonly CandidateRow[]): CandidateRow[] {
  return [...candidates].sort((left, right) => {
    const leftStock = left.needed_items_in_stock > 0 ? 1 : 0;
    const rightStock = right.needed_items_in_stock > 0 ? 1 : 0;
    if (leftStock !== rightStock) return rightStock - leftStock;
    if (left.open_supply_requests !== right.open_supply_requests) return left.open_supply_requests - right.open_supply_requests;
    if (left.distance_m !== right.distance_m) return left.distance_m - right.distance_m;
    return left.warehouse_id < right.warehouse_id ? -1 : left.warehouse_id > right.warehouse_id ? 1 : 0;
  });
}

/**
 * Sticky assignment. A stored AUTO primary is kept unless a re-rank was requested or it is no longer eligible.
 * A MANUAL primary is never replaced automatically; when it becomes ineligible it is kept and flagged.
 */
export function planAssignment(input: AssignmentPlanInput): AssignmentPlan {
  const ranked = rankCandidates(input.candidates);
  const eligible = new Map(ranked.map((candidate) => [candidate.warehouse_id, candidate]));
  const storedPrimary = input.stored.find((row) => row.role === 'PRIMARY') ?? null;

  let primaryId: string | null = null;
  let primarySource: AssignmentSource | null = null;
  if (input.override) {
    primaryId = input.override;
    primarySource = 'MANUAL';
  } else if (storedPrimary?.source === 'MANUAL' && !input.clearManual) {
    primaryId = storedPrimary.warehouse_id;
    primarySource = 'MANUAL';
  } else {
    const rerank = input.rerank || input.clearManual || !storedPrimary || !eligible.has(storedPrimary.warehouse_id);
    if (!rerank && storedPrimary) {
      primaryId = storedPrimary.warehouse_id;
    } else if (ranked[0]) {
      primaryId = ranked[0].warehouse_id;
    }
    primarySource = primaryId ? 'AUTO' : null;
  }

  const distanceOf = (warehouseId: string): number | null => {
    const candidate = eligible.get(warehouseId);
    if (candidate) return candidate.distance_m;
    return input.stored.find((row) => row.warehouse_id === warehouseId)?.distance_m ?? null;
  };

  const rows: DesiredAssignment[] = [];
  if (primaryId && primarySource) {
    rows.push({ warehouse_id: primaryId, role: 'PRIMARY', source: primarySource, distance_m: distanceOf(primaryId) });
  }
  for (const candidate of ranked) {
    if (candidate.warehouse_id === primaryId) continue;
    rows.push({ warehouse_id: candidate.warehouse_id, role: 'BACKUP', source: 'AUTO', distance_m: candidate.distance_m });
  }
  return { primaryId, primarySource, rows };
}

/** Flags are derived from the current state, never stored. */
export function deriveFlags(input: {
  hasArea: boolean;
  primary: Pick<StoredAssignment, 'warehouse_id' | 'source'> | null;
  eligibleIds: ReadonlySet<string>;
}): AssignmentFlag[] {
  const flags: AssignmentFlag[] = [];
  if (!input.hasArea) flags.push('CAMPAIGN_AREA_MISSING');
  if (input.primary?.source === 'MANUAL' && !input.eligibleIds.has(input.primary.warehouse_id)) flags.push('MANUAL_PRIMARY_INELIGIBLE');
  if (input.eligibleIds.size === 0) flags.push('NO_SERVING_WAREHOUSE');
  return flags;
}

/** True when the stored rows already equal the desired rows (no write, no version bump needed). */
export function sameAssignment(desired: readonly DesiredAssignment[], stored: readonly StoredAssignment[]): boolean {
  if (desired.length !== stored.length) return false;
  return desired.every((row) => {
    const current = stored.find((item) => item.warehouse_id === row.warehouse_id);
    return Boolean(current) && current!.role === row.role && current!.source === row.source &&
      (current!.distance_m ?? null) === (row.distance_m ?? null);
  });
}

export function sameCampaignArea(left: CampaignArea | null, right: CampaignArea): boolean {
  if (!left) return false;
  if (left.center === null || right.center === null) return left.center === right.center && left.radius_m === right.radius_m;
  return left.center.lat === right.center.lat && left.center.lng === right.center.lng && left.radius_m === right.radius_m;
}

export function requireCampaignWarehousePermission(
  session: AuthenticatedLogisticsSession,
  permission: Permission,
  campaignId: string,
): void {
  if (!hasPermission(session.grants, permission, { campaignId })) throw new AppError('FORBIDDEN', { status: 403 });
}

/** A warehouse change matters to assignment only when its status, location or radius changed. */
export function serviceAreaChanged(before: WarehouseServiceArea | null, after: WarehouseServiceArea): boolean {
  if (!before) return true;
  return before.status !== after.status || before.radius_m !== after.radius_m ||
    before.location?.lat !== after.location?.lat || before.location?.lng !== after.location?.lng;
}

export function assignmentRequestKey(value: string | undefined): string {
  if (!value) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return value;
}

export function assertAssignmentVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: actual } });
}

export function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'UNEXPECTED_ERROR';
}

/** Maps a warehouse row (with longitude/latitude from the asset select) to the service area used by assignment. */
export function warehouseServiceArea(row: {
  id: string;
  status: 'ACTIVE' | 'INACTIVE';
  longitude?: number | string | null;
  latitude?: number | string | null;
  service_radius_m?: number | string | null;
}): WarehouseServiceArea {
  const hasLocation = row.longitude != null && row.latitude != null;
  return {
    warehouse_id: row.id,
    status: row.status,
    location: hasLocation ? { lat: Number(row.latitude), lng: Number(row.longitude) } : null,
    radius_m: row.service_radius_m == null ? null : Number(row.service_radius_m),
  };
}

/** Same mapping for the warehouse view returned by the assets commands (GeoJSON location, [lng, lat]). */
export function warehouseServiceAreaFromView(view: Record<string, unknown>): WarehouseServiceArea {
  const location = view.location as { coordinates?: [number, number] } | null | undefined;
  return {
    warehouse_id: String(view.id),
    status: view.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    location: location?.coordinates ? { lat: Number(location.coordinates[1]), lng: Number(location.coordinates[0]) } : null,
    radius_m: view.service_radius_m == null ? null : Number(view.service_radius_m),
  };
}
