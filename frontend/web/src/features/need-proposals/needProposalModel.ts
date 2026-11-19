// Pure helpers and read-model types for the manager proposal queue (GET /need-proposals). No React imports:
// tests load this file directly.
import { logisticsCommandErrorCopy } from '../../i18n/commandErrors.ts';

export interface ProposalSos {
  people: number;
  children: number;
  elderly: number;
  adults: number;
}

export interface ProposalReason {
  code: string;
  message: string;
}

export interface ProposalLine {
  need_id: string;
  version: number;
  category: string;
  item: { id: string; name: string; unit: { code: string; display_name: string; scale: number } };
  quantity: string;
  /** Free stock at the campaign's primary warehouse; null when there is no primary warehouse. */
  available: string | null;
  shortfall: boolean | null;
  reason_codes: string[];
  reasons: ProposalReason[];
}

export interface ProposalExtraction {
  source: string;
  model: string | null;
  unmatched_terms: string[];
  mentioned_items: { item_id: string; item_name: string | null; category: string | null }[];
  reasons: ProposalReason[];
}

/** One SOS (request and work cycle) with its open ESTIMATED lines. */
export interface ProposalGroup {
  cycle_id: string;
  request_id: string;
  work_cycle: number;
  campaign_id: string | null;
  sos: ProposalSos | null;
  warehouse: { id: string } | null;
  lines: ProposalLine[];
  extraction: ProposalExtraction | null;
}

export interface ProposalPage {
  items: ProposalGroup[];
  more?: boolean;
  cursor?: string;
  /** Present for system-scope managers: SOS cycles outside every campaign that still hold open proposals. */
  unassigned_total?: number;
  generated_at?: string;
}

/** NEED_ESTIMATE_CONFIRM is held by OPERATIONS_MANAGER only. The backend enforces it; hiding controls is not the control. */
export const canManageNeedProposals = (roles: ReadonlySet<string>) => roles.has('OPERATIONS_MANAGER');

export interface ProposalGroupSummary {
  lineCount: number;
  shortfallCount: number;
  hasWarehouse: boolean;
  unmatchedCount: number;
  mentionedCount: number;
}

export function summarizeProposalGroup(group: Pick<ProposalGroup, 'lines' | 'warehouse' | 'extraction'>): ProposalGroupSummary {
  return {
    lineCount: group.lines.length,
    shortfallCount: group.lines.filter((line) => line.shortfall === true).length,
    hasWarehouse: group.warehouse !== null,
    unmatchedCount: group.extraction?.unmatched_terms.length ?? 0,
    mentionedCount: group.extraction?.mentioned_items.length ?? 0,
  };
}

/** Decimal strings from the API, compared by value ("2" equals "2.000"). */
export function sameQuantity(left: string, right: string): boolean {
  return Number(left) === Number(right);
}

export interface SwapItem {
  id: string;
  name: string;
  item_type: { code: string };
  unit: { display_name?: string; scale: number };
}

/**
 * Items the manager may swap a line to: ACTIVE items of the same item type as the line's current item.
 * The current item is always included, so the select can show it even if it is no longer ACTIVE.
 */
export function swapOptionsFor(line: ProposalLine, activeItems: readonly SwapItem[]): { value: string; label: string }[] {
  const current = activeItems.find((item) => item.id === line.item.id);
  const typeCode = current?.item_type.code;
  const options = typeCode
    ? activeItems.filter((item) => item.item_type.code === typeCode).map((item) => ({ value: item.id, label: item.name }))
    : [];
  if (!options.some((option) => option.value === line.item.id)) {
    options.unshift({ value: line.item.id, label: line.item.name });
  }
  return options;
}

export interface SequenceFailure<T> {
  index: number;
  line: T;
  error: unknown;
}

export interface SequenceResult<T> {
  done: T[];
  failure: SequenceFailure<T> | null;
}

/**
 * Runs one command per line, in order. The first failure stops the run: later lines are not attempted,
 * and the caller learns which line failed and which lines were already done.
 */
export async function runInSequence<T>(lines: readonly T[], run: (line: T) => Promise<unknown>): Promise<SequenceResult<T>> {
  const done: T[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    try {
      await run(line);
      done.push(line);
    } catch (error) {
      return { done, failure: { index, line, error } };
    }
  }
  return { done, failure: null };
}

/** Queue-specific copy for 403 and stale-version codes. Other codes come from the shared command copy. */
const proposalErrorCopy: Record<string, string> = {
  FORBIDDEN: 'Bạn không có quyền xác nhận hoặc từ chối đề xuất này.',
  VERSION_CONFLICT: 'Dòng nhu cầu đã thay đổi. Danh sách đã được tải lại; hãy kiểm tra trước khi thao tác tiếp.',
  STATE_TRANSITION_INVALID: 'Dòng nhu cầu không còn ở trạng thái chờ duyệt. Danh sách đã được tải lại.',
  CYCLE_SEALED: 'Đợt xử lý SOS này đã kết thúc nên không thể xác nhận hoặc từ chối dòng nhu cầu.',
};

/** Codes after which the list must be reloaded before the next action. */
export const staleProposalCodes = ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'] as const;

export function isStaleProposalError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (staleProposalCodes as readonly string[]).includes(String((error as { code: unknown }).code));
}

export function proposalErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (Object.hasOwn(proposalErrorCopy, code)) return proposalErrorCopy[code]!;
    if (Object.hasOwn(logisticsCommandErrorCopy, code)) return logisticsCommandErrorCopy[code]!;
  }
  return error instanceof Error && error.message ? error.message : 'Thao tác chưa được xác nhận. Vui lòng thử lại.';
}

/** A missing collection route means the running Logistics API has not been updated with this screen. */
export function proposalListErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    if (error.status === 404) return 'Dịch vụ Logistics đang chạy chưa có API đề xuất từ SOS. Cần cập nhật dịch vụ để xem danh sách này.';
    if (error.status === 403) return 'Tài khoản hiện tại chưa được cấp quyền xem đề xuất từ SOS trong phạm vi này.';
  }
  return proposalErrorMessage(error);
}
