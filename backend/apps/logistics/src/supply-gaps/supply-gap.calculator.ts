import { decimalFromUnits } from '../common/quantity';

// Pure supply-gap arithmetic. All quantities are bigint units at the item's unit scale (never floats), so the same
// item and unit are compared and nothing is summed across units. The I/O loader lives in supply-gaps.service.ts.

export type GapSeverity = 'YELLOW' | 'RED';
export type GapReasonCode =
  | 'DEMAND_EXCEEDS_SUPPLY' | 'NO_STOCK_AT_WAREHOUSE' | 'NEAR_CAPACITY' | 'CAMPAIGN_CONTENTION'
  | 'BACKUP_STOCK_AVAILABLE' | 'DRIVE_PLEDGE_APPLIED';
export type NeedSource = 'DECLARED' | 'ESTIMATED' | 'CONFIRMED';

/** Warning threshold: demand / supply >= 4 / 5 (0.8). */
export const YELLOW_RATIO_NUMERATOR = 4n;
export const YELLOW_RATIO_DENOMINATOR = 5n;
/** Draft target = gap x 1.10, rounded up at the item scale: ceil(gap x 11 / 10). */
const DRAFT_MARGIN_NUMERATOR = 11n;
const DRAFT_MARGIN_DENOMINATOR = 10n;
/** A dismissed gap reopens only when it grew by at least 25 percent (gap x 100 >= dismissed x 125). */
const REOPEN_GROWTH_NUMERATOR = 125n;
const REOPEN_GROWTH_DENOMINATOR = 100n;

export interface ItemScale {
  item_id: string;
  scale: number;
  name: string;
}

export interface NeedFact {
  campaign_id: string;
  item_id: string;
  source: NeedSource;
  /** relief_need.requested_quantity in units */
  requested: bigint;
  /** sum(commitment.quantity - commitment.released_quantity) for the need, in units */
  committed: bigint;
}

export interface StockFact {
  warehouse_id: string;
  item_id: string;
  on_hand: bigint;
  reserved: bigint;
}

/** Remaining target of one drive line at the warehouse: target minus what has already been received (see loader). */
export interface PledgeFact {
  warehouse_id: string;
  item_id: string;
  remaining: bigint;
}

export interface BackupFact {
  campaign_id: string;
  warehouse_id: string;
}

export interface WarehouseGapInput {
  warehouse_id: string;
  /** Campaigns whose PRIMARY warehouse is warehouse_id. Demand from any other campaign is ignored. */
  primary_campaign_ids: readonly string[];
  items: readonly ItemScale[];
  needs: readonly NeedFact[];
  /** Stock at this warehouse and at the BACKUP warehouses of its campaigns. */
  stock: readonly StockFact[];
  pledges: readonly PledgeFact[];
  backups: readonly BackupFact[];
}

export interface CampaignShare {
  campaign_id: string;
  unmet: bigint;
}

export interface WarehouseGap {
  warehouse_id: string;
  item_id: string;
  item_name: string;
  scale: number;
  demand: bigint;
  available: bigint;
  pledged: bigint;
  supply: bigint;
  gap: bigint;
  severity: GapSeverity;
  campaign_shares: CampaignShare[];
  campaign_ids: string[];
  backup_warehouse_ids: string[];
  reason_codes: GapReasonCode[];
}

export interface ForecastLine {
  item_id: string;
  scale: number;
  /** ESTIMATED demand only; never counted as demand for a gap. */
  forecast: bigint;
}

export interface WarehouseGapResult {
  gaps: WarehouseGap[];
  forecasts: ForecastLine[];
}

/** Unmet quantity of one need. Over-commitment is clamped to zero, never negative. */
export function unmetUnits(requested: bigint, committed: bigint): bigint {
  const difference = requested - committed;
  return difference > 0n ? difference : 0n;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positive(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

export function calculateWarehouseGaps(input: WarehouseGapInput): WarehouseGapResult {
  const primary = new Set(input.primary_campaign_ids);
  const itemById = new Map(input.items.map((item) => [item.item_id, item]));
  const itemOf = (itemId: string): ItemScale => {
    const item = itemById.get(itemId);
    if (!item) throw new Error('SUPPLY_GAP_ITEM_UNKNOWN');
    return item;
  };
  const stockOf = (warehouseId: string, itemId: string): bigint => {
    const row = input.stock.find((stock) => stock.warehouse_id === warehouseId && stock.item_id === itemId);
    return row ? positive(row.on_hand - row.reserved) : 0n;
  };

  // Demand per item and campaign. Only DECLARED and CONFIRMED lines count; ESTIMATED lines become a forecast.
  const demandByItem = new Map<string, Map<string, bigint>>();
  const forecastByItem = new Map<string, bigint>();
  for (const need of input.needs) {
    if (!primary.has(need.campaign_id)) continue;
    const unmet = unmetUnits(need.requested, need.committed);
    if (unmet === 0n) continue;
    if (need.source === 'ESTIMATED') {
      forecastByItem.set(need.item_id, (forecastByItem.get(need.item_id) ?? 0n) + unmet);
    } else if (need.source === 'DECLARED' || need.source === 'CONFIRMED') {
      const shares = demandByItem.get(need.item_id) ?? new Map<string, bigint>();
      shares.set(need.campaign_id, (shares.get(need.campaign_id) ?? 0n) + unmet);
      demandByItem.set(need.item_id, shares);
    } else {
      throw new Error('SUPPLY_GAP_NEED_SOURCE_UNKNOWN');
    }
  }

  const gaps: WarehouseGap[] = [];
  for (const itemId of [...demandByItem.keys()].sort(compareText)) {
    const item = itemOf(itemId);
    const shares = demandByItem.get(itemId)!;
    let demand = 0n;
    for (const unmet of shares.values()) demand += unmet;
    if (demand === 0n) continue;

    const available = stockOf(input.warehouse_id, itemId);
    const pledged = input.pledges
      .filter((pledge) => pledge.warehouse_id === input.warehouse_id && pledge.item_id === itemId)
      .reduce((total, pledge) => total + positive(pledge.remaining), 0n);
    const supply = available + pledged;
    const gap = demand - supply;

    // A pledge already covers part of the demand once a draft is accepted, so the 1.10 x gap draft would leave
    // demand/supply near 0.91 and bring a YELLOW warning back. Pledged supply therefore silences YELLOW; RED is unchanged.
    let severity: GapSeverity | null = null;
    if (gap > 0n) severity = 'RED';
    else if (pledged === 0n && supply > 0n && demand * YELLOW_RATIO_DENOMINATOR >= supply * YELLOW_RATIO_NUMERATOR) severity = 'YELLOW';
    if (!severity) continue;

    const campaignShares = [...shares.entries()]
      .map(([campaign_id, unmet]) => ({ campaign_id, unmet }))
      .sort((a, b) => (a.unmet === b.unmet ? compareText(a.campaign_id, b.campaign_id) : a.unmet > b.unmet ? -1 : 1));
    const campaignIds = campaignShares.map((share) => share.campaign_id);

    // Backup candidates: BACKUP warehouses of the contending campaigns that can cover the whole gap by themselves.
    // Nothing is transferred automatically; the manager decides.
    const backupWarehouseIds = severity === 'RED'
      ? [...new Set(input.backups
        .filter((backup) => campaignIds.includes(backup.campaign_id) && backup.warehouse_id !== input.warehouse_id)
        .filter((backup) => stockOf(backup.warehouse_id, itemId) >= gap)
        .map((backup) => backup.warehouse_id))].sort(compareText)
      : [];

    const reasonCodes: GapReasonCode[] = [];
    if (severity === 'RED') reasonCodes.push('DEMAND_EXCEEDS_SUPPLY');
    if (available === 0n) reasonCodes.push('NO_STOCK_AT_WAREHOUSE');
    if (severity === 'YELLOW') reasonCodes.push('NEAR_CAPACITY');
    if (campaignIds.length > 1) reasonCodes.push('CAMPAIGN_CONTENTION');
    if (backupWarehouseIds.length > 0) reasonCodes.push('BACKUP_STOCK_AVAILABLE');
    if (pledged > 0n) reasonCodes.push('DRIVE_PLEDGE_APPLIED');

    gaps.push({
      warehouse_id: input.warehouse_id,
      item_id: itemId,
      item_name: item.name,
      scale: item.scale,
      demand,
      available,
      pledged,
      supply,
      gap,
      severity,
      campaign_shares: campaignShares,
      campaign_ids: campaignIds,
      backup_warehouse_ids: backupWarehouseIds,
      reason_codes: reasonCodes,
    });
  }

  const forecasts: ForecastLine[] = [...forecastByItem.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([itemId, forecast]) => ({ item_id: itemId, scale: itemOf(itemId).scale, forecast }));
  return { gaps, forecasts };
}

export interface DismissedMarker {
  severity: GapSeverity;
  gap: bigint;
}

/**
 * Cooldown decision for a candidate gap while a dismissal is still in effect. A dismissed RED gap reopens only when
 * the current RED gap grew by at least 25 percent. A dismissed YELLOW warning reopens only when it becomes RED.
 */
export function reopensAfterDismissal(current: { severity: GapSeverity; gap: bigint }, dismissed: DismissedMarker | null): boolean {
  if (!dismissed) return true;
  if (current.severity !== 'RED') return false;
  if (dismissed.severity === 'YELLOW') return true;
  return current.gap * REOPEN_GROWTH_DENOMINATOR >= dismissed.gap * REOPEN_GROWTH_NUMERATOR;
}

export interface DriveDraftInput {
  warehouse_id: string;
  item: ItemScale;
  gap: bigint;
  campaign_id: string;
  opens_at: Date;
  closes_at: Date;
}

/** Draft donation drive for a RED gap. Humans review and accept it; the system never creates the drive itself. */
export function buildDriveDraft(input: DriveDraftInput): Record<string, unknown> {
  const target = (input.gap * DRAFT_MARGIN_NUMERATOR + (DRAFT_MARGIN_DENOMINATOR - 1n)) / DRAFT_MARGIN_DENOMINATOR;
  const name = input.item.name.trim().normalize('NFC');
  return {
    title: Array.from(`Quyên góp bổ sung ${name}`.normalize('NFC')).slice(0, 200).join(''),
    description: 'Đề xuất tự động do thiếu hụt tồn kho tại kho phân phối. Người quản lý cần xem xét trước khi mở đợt.',
    intake_warehouse_id: input.warehouse_id,
    campaign_id: input.campaign_id,
    opens_at: input.opens_at.toISOString(),
    closes_at: input.closes_at.toISOString(),
    items: [{
      item_id: input.item.item_id,
      target_quantity: decimalFromUnits(target, input.item.scale),
      acceptance_note: 'Đề xuất bổ sung theo thiếu hụt tồn kho; cần người quản lý xác nhận.',
    }],
  };
}
