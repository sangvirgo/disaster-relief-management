// Pure status for the read-only "Đề xuất cấp phát" block on a coordinator SOS. No React imports (tests load this file).

/** SOS statuses before verification finishes. The coordinator verifies; the sweep then creates proposals. */
const awaitingVerification = ['SUBMITTED', 'VERIFYING'];
/** Closed requests: the proposal block is not shown. */
const closed = ['CANCELLED', 'REJECTED'];

export type ProposalStatusCode = 'AWAITING_VERIFICATION' | 'PENDING_MANAGER' | 'CONFIRMED' | 'NONE';

export interface PanelNeedLine {
  source: string;
  status: string;
}

export function proposalPanelStatus(input: {
  requestStatus: string;
  needsReliefSupplies: boolean;
  lines: readonly PanelNeedLine[];
}): { visible: boolean; code: ProposalStatusCode; label: string } {
  const live = input.lines.filter((line) => line.status !== 'CANCELLED');
  if (!input.needsReliefSupplies || closed.includes(input.requestStatus)) {
    return { visible: false, code: 'NONE', label: '' };
  }
  if (awaitingVerification.includes(input.requestStatus)) {
    return { visible: true, code: 'AWAITING_VERIFICATION', label: 'Chờ xác minh' };
  }
  if (live.some((line) => line.source === 'ESTIMATED')) {
    return { visible: true, code: 'PENDING_MANAGER', label: 'Đang chờ quản lý duyệt' };
  }
  if (live.some((line) => line.source === 'CONFIRMED')) {
    return { visible: true, code: 'CONFIRMED', label: 'Đã duyệt' };
  }
  return { visible: true, code: 'NONE', label: 'Chưa có đề xuất' };
}
