import { AppError } from '../../../../packages/technical/src/errors/errors';

export type ResolutionBasis = 'RESCUE_COMPLETED' | 'SUPPLY_ONLY' | 'NO_ACTION_REQUIRED';

export interface ResolutionMissionEvidence {
  status: string;
  hasOutcomeEvidence: boolean;
  failureReviewed: boolean;
}

export interface ResolutionNeedEvidence {
  status: string;
  delivered: string;
  reserved: string;
  unsettledIssued: string;
}

export interface ResolutionReadiness {
  basis: ResolutionBasis;
  reason: string;
  hasPendingSupplement: boolean;
  missions: readonly ResolutionMissionEvidence[];
  needs: readonly ResolutionNeedEvidence[];
}

const activeMissionStatuses = new Set(['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE']);
const terminalNeedStatuses = new Set(['FULFILLED', 'CANCELLED']);

function isPositiveQuantity(value: string): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return /[1-9]/u.test(value);
}

function block(reasons: readonly string[]): never {
  throw new AppError('RESOLUTION_BLOCKED', { status: 409, details: { reasons: [...new Set(reasons)] } });
}

export function assertResolutionReady(input: ResolutionReadiness): void {
  if (!input.reason.trim()) throw new AppError('REASON_REQUIRED', { status: 400 });
  if (input.hasPendingSupplement) throw new AppError('PENDING_SUPPLEMENT_REVIEW', { status: 409 });

  const reasons: string[] = [];
  if (input.missions.some(({ status }) => activeMissionStatuses.has(status))) reasons.push('ACTIVE_MISSION');
  if (input.missions.some(({ status, failureReviewed }) => status === 'FAILED' && !failureReviewed)) {
    reasons.push('FAILED_MISSION_REVIEW_REQUIRED');
  }
  if (reasons.length) block(reasons);

  const completedMissions = input.missions.filter(({ status }) => status === 'COMPLETED');
  const delivered = input.needs.some(({ delivered: amount }) => isPositiveQuantity(amount));
  const reserved = input.needs.some(({ reserved: amount }) => isPositiveQuantity(amount));

  switch (input.basis) {
    case 'RESCUE_COMPLETED':
      if (!completedMissions.some(({ hasOutcomeEvidence }) => hasOutcomeEvidence)) {
        block(['NO_COMPLETED_MISSION_EVIDENCE']);
      }
      return;
    case 'SUPPLY_ONLY': {
      if (completedMissions.length > 0 || !delivered) {
        throw new AppError('RESOLUTION_BASIS_INVALID', { status: 409 });
      }
      const unsettled = input.needs.some(({ status, reserved: quantity, unsettledIssued }) =>
        !terminalNeedStatuses.has(status) || isPositiveQuantity(quantity) || isPositiveQuantity(unsettledIssued));
      if (unsettled) block(['OPEN_NEED', 'UNSETTLED_ISSUE']);
      return;
    }
    case 'NO_ACTION_REQUIRED':
      if (completedMissions.length > 0 || delivered || reserved) {
        throw new AppError('RESOLUTION_BASIS_INVALID', { status: 409 });
      }
      return;
  }
}
