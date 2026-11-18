import type { operations } from '../../api/generated/logistics';
import { formatQuantity } from '../../i18n/quantity.ts';

/*
 * Pure helpers for the pickup-ticket screens: types, role gating, self-action hints,
 * decimal arithmetic and the close-out / delivery validators. No React, no network.
 * Permission names mirror docs/backend/05-permissions.md (section 1) and the backend gates.
 */

export type PickupTicket = operations['logisticsPickupTicketsDetail']['responses'][200]['content']['application/json'];
export type PickupTicketLine = PickupTicket['lines'][number];
export type PickupTicketList = operations['logisticsPickupTicketsList']['responses'][200]['content']['application/json'];
export type PickupCloseout = operations['logisticsPickupTicketsCloseout']['responses'][200]['content']['application/json'];
export type PickupCloseoutLine = PickupCloseout['lines'][number];
export type RetireReason = NonNullable<PickupCloseoutLine['retire_reason']>;

export type PickupPermission =
  | 'PICKUP_TICKET_VIEW'
  | 'PICKUP_TICKET_MANAGE'
  | 'PICKUP_CLOSEOUT_SUBMIT'
  | 'PICKUP_CLOSEOUT_REVIEW'
  | 'COMMITMENT_MANAGE'
  | 'DISTRIBUTION_PREPARE'
  | 'DISTRIBUTION_REVIEW'
  | 'DISTRIBUTION_DISPATCH'
  | 'HANDOFF_RECORD'
  | 'DONATION_INTAKE';

/** Subset of ROLE_PERMISSIONS (backend/packages/identity-contracts) that the pickup screens use. */
const rolePermissions: Record<string, readonly PickupPermission[]> = {
  COORDINATOR: ['PICKUP_TICKET_VIEW', 'PICKUP_TICKET_MANAGE', 'PICKUP_CLOSEOUT_SUBMIT'],
  OPERATIONS_MANAGER: [
    'PICKUP_TICKET_VIEW', 'PICKUP_TICKET_MANAGE', 'PICKUP_CLOSEOUT_SUBMIT', 'PICKUP_CLOSEOUT_REVIEW',
    'COMMITMENT_MANAGE', 'DISTRIBUTION_PREPARE', 'DISTRIBUTION_REVIEW', 'DISTRIBUTION_DISPATCH',
    'HANDOFF_RECORD', 'DONATION_INTAKE',
  ],
  REVIEWER: ['PICKUP_CLOSEOUT_REVIEW', 'DISTRIBUTION_REVIEW', 'PICKUP_TICKET_VIEW'],
};

export function permissionsForRoles(roleCodes: Iterable<string>): ReadonlySet<PickupPermission> {
  const granted = new Set<PickupPermission>();
  for (const role of roleCodes) for (const permission of rolePermissions[role] ?? []) granted.add(permission);
  return granted;
}

/**
 * Permissions each action needs in the UI. The backend is the authority; these only decide what to show.
 * confirm needs PICKUP_TICKET_MANAGE as its gate, so REVIEWER (no MANAGE) is not offered confirm.
 */
export const PICKUP_ACTION_PERMISSIONS = {
  create: ['PICKUP_TICKET_MANAGE'],
  cancel: ['PICKUP_TICKET_MANAGE'],
  reserve: ['PICKUP_TICKET_MANAGE', 'COMMITMENT_MANAGE', 'DISTRIBUTION_PREPARE'],
  confirm: ['PICKUP_TICKET_MANAGE', 'DISTRIBUTION_REVIEW'],
  handover: ['DISTRIBUTION_DISPATCH'],
  delivery: ['PICKUP_TICKET_MANAGE', 'HANDOFF_RECORD'],
  closeoutView: ['PICKUP_TICKET_VIEW'],
  closeoutSave: ['PICKUP_CLOSEOUT_SUBMIT'],
  closeoutSubmit: ['PICKUP_CLOSEOUT_SUBMIT'],
  closeoutReview: ['PICKUP_CLOSEOUT_REVIEW'],
} as const satisfies Record<string, readonly PickupPermission[]>;

export type PickupActionKey = keyof typeof PICKUP_ACTION_PERMISSIONS;

export function canPickupAction(action: PickupActionKey, granted: ReadonlySet<string>): boolean {
  return PICKUP_ACTION_PERMISSIONS[action].every((permission) => granted.has(permission));
}

/** Pickup tickets are created only once the team has accepted (or is working) the mission. */
export const MISSION_CAN_HAVE_TICKET = ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'] as const;

export interface SelfActionTicket {
  reserved_by?: string | null;
  confirmed_by?: string | null;
  handed_over_by?: string | null;
}

/** Same-user rules that the backend enforces; the UI explains them before the request is sent. */
export function selfActionBlock(
  action: 'confirm' | 'handover' | 'review',
  currentUserId: string,
  ticket: SelfActionTicket,
): string | null {
  if (action === 'confirm' && ticket.reserved_by === currentUserId) {
    return 'Người giữ hàng không thể tự xác nhận phiếu này. Hãy nhờ quản lý vận hành khác xác nhận.';
  }
  if (action === 'handover' && ticket.confirmed_by === currentUserId) {
    return 'Người xác nhận phiếu không thể bàn giao cùng phiếu này. Hãy nhờ quản lý vận hành khác bàn giao.';
  }
  if (action === 'review' && ticket.handed_over_by === currentUserId) {
    return 'Người đã bàn giao hàng không thể duyệt phiếu đối soát này.';
  }
  return null;
}

/** Returns that post a RETURN handoff need DISTRIBUTION_DISPATCH or DONATION_INTAKE; REVIEWER has neither. */
export function reviewReturnBlock(granted: ReadonlySet<string>, lines: readonly { returned_quantity: string }[]): string | null {
  const returnsGoods = lines.some((line) => /^\d+(\.\d+)?$/.test(line.returned_quantity) && Number(line.returned_quantity) > 0);
  const canReturn = granted.has('DISTRIBUTION_DISPATCH') || granted.has('DONATION_INTAKE');
  if (returnsGoods && !canReturn) {
    return 'Phiếu này có hàng trả về kho nên cần quản lý vận hành duyệt. Người duyệt chỉ có quyền duyệt phiếu không trả hàng về kho.';
  }
  return null;
}

// ---------- Decimal arithmetic on API decimal strings (no floating point) ----------

const DECIMAL = /^\d+(\.\d+)?$/;

export function isDecimal(value: string): boolean {
  return DECIMAL.test(value.trim());
}

/** Scales decimal strings to a common integer scale. Returns null when any value is not a plain decimal. */
export function scaledUnits(values: readonly string[]): bigint[] | null {
  const trimmed = values.map((value) => value.trim());
  if (!trimmed.every((value) => DECIMAL.test(value))) return null;
  const scale = Math.max(...trimmed.map((value) => (value.split('.')[1] ?? '').length));
  return trimmed.map((value) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(scale, '0'));
  });
}

// ---------- Close-out draft ----------

export interface CloseoutDraftLine {
  item_id: string;
  item_name: string;
  unit_code: string;
  returnable: boolean;
  perishable: boolean;
  held: string;
  delivered: string;
  returned: string;
  retired: string;
  retire_reason: RetireReason | null;
  note: string | null;
}

export function draftFromCloseout(lines: readonly PickupCloseoutLine[]): CloseoutDraftLine[] {
  return lines.map((line) => ({
    item_id: line.item_id,
    item_name: line.item_name,
    unit_code: line.unit_code,
    returnable: line.returnable !== false,
    perishable: line.perishable === true,
    held: line.held_quantity,
    delivered: line.delivered_quantity,
    returned: line.returned_quantity,
    retired: line.retired_quantity,
    retire_reason: line.retire_reason ?? null,
    note: line.note ?? null,
  }));
}

/** Vietnamese problems for one close-out line. Empty when the line balances: delivered + returned + retired = held. */
export function closeoutLineIssues(line: CloseoutDraftLine): string[] {
  if (!isDecimal(line.returned) || !isDecimal(line.retired)) {
    return ['Số lượng trả lại và hủy phải là số không âm, ví dụ 2 hoặc 0.5.'];
  }
  const issues: string[] = [];
  const returned = Number(line.returned);
  if (returned > 0 && (!line.returnable || line.perishable)) {
    issues.push('Mặt hàng này không được nhập lại kho. Hãy chuyển số lượng sang hủy và chọn lý do.');
  }
  const units = scaledUnits([line.held, line.delivered, line.returned, line.retired]);
  if (units) {
    const [held, delivered, returnedUnits, retiredUnits] = units;
    if (delivered + returnedUnits + retiredUnits !== held) {
      issues.push(
        `Đã giao ${formatQuantity(line.delivered)} + trả lại ${formatQuantity(line.returned)} + hủy ${formatQuantity(line.retired)} `
        + `phải bằng số đã giữ ${formatQuantity(line.held)} ${line.unit_code}.`,
      );
    }
  }
  if (Number(line.retired) > 0 && !line.retire_reason) {
    issues.push('Cần chọn lý do cho số lượng hủy.');
  }
  return issues;
}

/** Map item_id -> first Vietnamese problem. Lines that balance are absent. */
export function validateCloseoutDraft(lines: readonly CloseoutDraftLine[]): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const line of lines) {
    const [first] = closeoutLineIssues(line);
    if (first) problems[line.item_id] = first;
  }
  return problems;
}

export interface CloseoutSaveLine {
  item_id: string;
  returned_quantity: string;
  retired_quantity: string;
  retire_reason?: RetireReason;
  note?: string;
}

export function closeoutSavePayload(lines: readonly CloseoutDraftLine[]): CloseoutSaveLine[] {
  return lines.map((line) => ({
    item_id: line.item_id,
    returned_quantity: line.returned.trim(),
    retired_quantity: line.retired.trim(),
    ...(Number(line.retired) > 0 && line.retire_reason ? { retire_reason: line.retire_reason } : {}),
    ...(line.note ? { note: line.note } : {}),
  }));
}

export function rejectNoteError(note: string): string | null {
  const trimmed = note.trim();
  if (!trimmed) return 'Cần ghi lý do khi từ chối phiếu đối soát.';
  if (trimmed.length > 2000) return 'Lý do từ chối không được vượt quá 2.000 ký tự.';
  return null;
}

// ---------- Deliveries ----------

export interface DeliveryDraftLine {
  item_id: string;
  item_name: string;
  unit_code: string;
  remaining: string;
  quantity: string;
}

export interface DeliveryValidation {
  valid: boolean;
  fieldErrors: Record<string, string>;
  formError: string | null;
  lines: { item_id: string; quantity: string }[];
}

const FUTURE_TOLERANCE_MS = 5 * 60_000;

export function validateDelivery(
  lines: readonly DeliveryDraftLine[],
  occurredAt: string,
  now: Date,
): DeliveryValidation {
  const fieldErrors: Record<string, string> = {};
  const included: { item_id: string; quantity: string }[] = [];
  for (const line of lines) {
    const quantity = line.quantity.trim();
    if (!quantity) continue;
    const units = scaledUnits([quantity, line.remaining]);
    if (!units) {
      fieldErrors[`quantity:${line.item_id}`] = 'Nhập số lượng dương, ví dụ 2 hoặc 0.5.';
      continue;
    }
    const [quantityUnits, remainingUnits] = units;
    if (quantityUnits === 0n) {
      fieldErrors[`quantity:${line.item_id}`] = 'Số lượng phải lớn hơn 0.';
    } else if (quantityUnits > remainingUnits) {
      fieldErrors[`quantity:${line.item_id}`] =
        `Không được vượt quá số đang giữ: ${formatQuantity(line.remaining)} ${line.unit_code}.`;
    } else {
      included.push({ item_id: line.item_id, quantity });
    }
  }
  if (!occurredAt) {
    fieldErrors.occurred_at = 'Chọn thời điểm giao hàng.';
  } else {
    const time = Date.parse(occurredAt);
    if (Number.isNaN(time)) fieldErrors.occurred_at = 'Thời điểm giao hàng không hợp lệ.';
    else if (time > now.getTime() + FUTURE_TOLERANCE_MS) fieldErrors.occurred_at = 'Thời điểm giao hàng không được ở tương lai.';
  }
  const hasErrors = Object.keys(fieldErrors).length > 0;
  const formError = !hasErrors && included.length === 0 ? 'Nhập số lượng cho ít nhất một mặt hàng.' : null;
  return { valid: !hasErrors && included.length > 0, fieldErrors, formError, lines: included };
}

/** Local datetime-local value (YYYY-MM-DDTHH:mm) for the given instant. */
export function localDateTimeValue(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}
