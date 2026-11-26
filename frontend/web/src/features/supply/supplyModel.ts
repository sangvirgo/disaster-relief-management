import type { BadgeTone } from '../../components/ui/Badge';
import { formatQuantity } from '../../i18n/quantity.ts';

/** Supply requests (2026-11-26): a team asks for goods for its mission; the warehouse hands them over against a code. */
export type SupplyStatus = 'READY' | 'HANDED_OVER' | 'CANCELLED' | 'EXPIRED';

export interface SupplyWarehouse {
  id: string;
  name: string;
  address_note: string | null;
  location: { lat: number; lng: number } | null;
}

export interface SupplyTeamLine {
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  requested_quantity: string;
  reserved_quantity: string;
  shortfall_quantity: string;
}

/** What the team leader, its members and the coordinator see: includes the pickup code. */
export interface SupplyTeamRequest {
  id: string;
  mission_id: string;
  team_id: string;
  team_name: string;
  status: SupplyStatus;
  pickup_code: string | null;
  on_behalf: boolean;
  warehouse: SupplyWarehouse;
  expires_at: string;
  handed_over_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  version: number;
  created_at: string;
  lines: SupplyTeamLine[];
  has_shortfall: boolean;
}

export interface MissionSupply {
  items: SupplyTeamRequest[];
  can_request: boolean;
}

export type SuggestionBasis = 'AI_TEXT' | 'NORM' | 'CONFIRMED';

export interface SupplySuggestion {
  mission_id: string;
  lines: Array<{ item_id: string; item_name: string; unit_code: string; unit_name: string; quantity: string; basis: SuggestionBasis }>;
}

/** What warehouse staff see: the team name and goods only. No SOS, mission, place or code. */
export interface SupplyQueueRow {
  id: string;
  team_name: string;
  status: SupplyStatus;
  warehouse: { id: string; name: string };
  expires_at: string;
  handed_over_at: string | null;
  cancelled_at: string | null;
  version: number;
  created_at: string;
  lines: Array<{ item_id: string; item_name: string; unit_code: string; unit_name: string; quantity: string }>;
}

export interface SupplyQueuePage {
  items: SupplyQueueRow[];
  more: boolean;
  cursor?: string;
}

export const supplyStatusLabels: Record<SupplyStatus, string> = {
  READY: 'Chờ nhận hàng',
  HANDED_OVER: 'Đã giao cho đội',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn nhận',
};

export const supplyStatusTones: Record<SupplyStatus, BadgeTone> = {
  READY: 'warning',
  HANDED_OVER: 'success',
  CANCELLED: 'neutral',
  EXPIRED: 'danger',
};

export const suggestionBasisLabels: Record<SuggestionBasis, string> = {
  AI_TEXT: 'AI gợi ý từ nội dung SOS',
  NORM: 'Theo định mức số người',
  CONFIRMED: 'Nhu cầu đã xác nhận',
};

export function quantityText(value: string, unit: string): string {
  return `${formatQuantity(value)} ${unit}`;
}

/** "còn 2 giờ 15 phút" / "quá hạn" — the deadline in words, for both the team and the warehouse. */
export function deadlineText(expiresAt: string, now = Date.now()): string {
  const left = Date.parse(expiresAt) - now;
  if (!Number.isFinite(left)) return '';
  if (left <= 0) return 'Đã quá hạn nhận';
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return `Còn ${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Còn ${hours} giờ ${rest} phút` : `Còn ${hours} giờ`;
}

export function isUrgent(expiresAt: string, now = Date.now()): boolean {
  const left = Date.parse(expiresAt) - now;
  return Number.isFinite(left) && left <= 60 * 60_000;
}

export function linesSummary(lines: ReadonlyArray<{ item_name: string; quantity?: string; reserved_quantity?: string; unit_name: string }>): string {
  if (!lines.length) return 'Không còn hàng để giao';
  const [first, ...rest] = lines;
  const amount = first.quantity ?? first.reserved_quantity ?? '0';
  return `${first.item_name} ${quantityText(amount, first.unit_name)}${rest.length ? ` · +${rest.length} mặt hàng` : ''}`;
}

/** Keeps only digits, at most six, as the staff member types the team's code. */
export function normalizePickupCode(value: string): string {
  return value.replace(/\D+/gu, '').slice(0, 6);
}
