// Pure helpers and read-model types for supply gaps, campaign warehouses and need norms. No React imports (tests load this file directly).

export type GapSeverity = 'RED' | 'YELLOW';
export type GapStatus = 'OPEN' | 'ACCEPTED' | 'DISMISSED' | 'EXPIRED';

export interface SupplyGapReason {
  code: string;
  message: string;
}

export interface SupplyGapDraftItem {
  item_id: string;
  target_quantity: string;
  acceptance_note?: string;
}

export interface SupplyGapDraft {
  title?: string;
  description?: string | null;
  intake_warehouse_id?: string;
  campaign_id?: string | null;
  opens_at?: string;
  closes_at?: string;
  items?: SupplyGapDraftItem[];
}

export interface SupplyGap {
  id: string;
  status: GapStatus;
  severity: GapSeverity;
  warehouse_id: string;
  warehouse_name: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  scale: number;
  demand: string;
  supply: string;
  pledged: string;
  gap_qty: string;
  forecast_demand: string;
  campaign_ids: string[];
  backup_warehouse_ids: string[];
  reason_codes: string[];
  reasons: SupplyGapReason[];
  draft: SupplyGapDraft;
  drive_id: string | null;
  dismissed_reason: string | null;
  dismissed_until: string | null;
  computed_at: string | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface SupplyGapList {
  items: SupplyGap[];
  more?: boolean;
  cursor?: string;
  generated_at?: string;
}

export interface CampaignWarehouseRow {
  warehouse_id: string;
  name: string;
  role: 'PRIMARY' | 'BACKUP' | null;
  source: 'AUTO' | 'MANUAL' | null;
  distance_m: number;
  eligible: boolean;
  stock: { open_needed_items: number; needed_items_in_stock: number };
  open_distributions: number;
}

export interface CampaignWarehouseView {
  campaign_id: string;
  campaign_status: string;
  assignment_version: number;
  area: { center: { lat: number; lng: number }; radius_m: number } | null;
  primary: { warehouse_id: string; source: 'AUTO' | 'MANUAL'; eligible: boolean } | null;
  warehouses: CampaignWarehouseRow[];
  flags: string[];
  proposed_primary_warehouse_id?: string | null;
  generated_at: string;
}

export interface NeedNorm {
  id: string;
  category: string;
  item_type_code: string;
  quantity_basis: 'PER_PERSON_DAY' | 'PER_PERSON';
  qty_per_person_per_day: string;
  modifier_infant: string;
  modifier_elderly: string;
  active: boolean;
  version: number;
  updated_at: string | null;
}

/** Roles come from the session grants. Hidden UI is never the only control; the backend still enforces each permission. */
type RoleSet = ReadonlySet<string>;

/** SUPPLY_GAP_MANAGE: accept and dismiss. */
export const canManageSupplyGaps = (roles: RoleSet) => roles.has('OPERATIONS_MANAGER');
/** SUPPLY_GAP_VIEW: read-only warnings for coordinators and managers. */
export const canViewSupplyGapWarnings = (roles: RoleSet) => roles.has('COORDINATOR') || roles.has('OPERATIONS_MANAGER');
/** CAMPAIGN_WAREHOUSE_MANAGE: change the primary warehouse and re-evaluate. */
export const canManageCampaignWarehouses = (roles: RoleSet) => roles.has('OPERATIONS_MANAGER');
/** NEED_NORM_MANAGE: edit the norm table. */
export const canManageNeedNorms = (roles: RoleSet) => roles.has('OPERATIONS_MANAGER');

/** Accept is offered only for a RED gap that is still OPEN. A YELLOW gap is a warning only. */
export function canAcceptSupplyGap(gap: Pick<SupplyGap, 'status' | 'severity'>): boolean {
  return gap.status === 'OPEN' && gap.severity === 'RED';
}

export function canDismissSupplyGap(gap: Pick<SupplyGap, 'status'>): boolean {
  return gap.status === 'OPEN';
}

export interface SupplyGapWarningSummary {
  open: number;
  red: number;
  yellow: number;
  /** The most urgent open gap: RED first, then the largest gap quantity. Used for the tooltip text. */
  top: SupplyGap | null;
}

export function summarizeSupplyGapWarnings(gaps: readonly SupplyGap[]): SupplyGapWarningSummary {
  const open = gaps.filter((gap) => gap.status === 'OPEN');
  const red = open.filter((gap) => gap.severity === 'RED').length;
  const yellow = open.filter((gap) => gap.severity === 'YELLOW').length;
  const ranked = [...open].sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'RED' ? -1 : 1;
    return Number(right.gap_qty) - Number(left.gap_qty);
  });
  return { open: open.length, red, yellow, top: ranked[0] ?? null };
}

/** Badge tone for the coordinator warning: any RED gap makes it danger, otherwise YELLOW warning, otherwise neutral. */
export function warningTone(summary: Pick<SupplyGapWarningSummary, 'red' | 'yellow'>): 'danger' | 'warning' | 'neutral' {
  if (summary.red > 0) return 'danger';
  if (summary.yellow > 0) return 'warning';
  return 'neutral';
}

/** Converts an ISO timestamp to the value a datetime-local input expects (local time, minute precision). */
export function isoToLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Distance label: metres below 1 km, otherwise kilometres with one decimal. Vietnamese decimal comma. */
export function distanceLabel(meters: number): string {
  if (!Number.isFinite(meters)) return 'Chưa rõ khoảng cách';
  if (meters < 1000) return `${Math.round(meters).toLocaleString('vi-VN')} m`;
  return `${(meters / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`;
}
