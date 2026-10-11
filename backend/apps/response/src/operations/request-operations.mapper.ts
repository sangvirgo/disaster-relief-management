import { toIso } from './request-operations.helpers';
import type { SupplementReviewDto, VerifyRequestDto } from './request-operations.dto';
import type { RequestEventRow } from './request-operations.types';

export function eventView(event: RequestEventRow): Record<string, unknown> {
  return { id: event.id, event_type: event.event_type, visibility: event.visibility, from_status: event.from_status,
    to_status: event.to_status, reason: event.reason, payload: event.payload, actor_user_id: event.actor_user_id, occurred_at: toIso(event.occurred_at) };
}

export function decisionView(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, decided_at: toIso(row.decided_at as Date | string) };
}

export function sourceRefsView(refs: VerifyRequestDto['source_refs'] | SupplementReviewDto['source_refs']): Record<string, string[]> {
  return {
    contact_attempt_ids: refs?.contact_attempt_ids ?? [],
    evidence_ids: refs?.evidence_ids ?? [],
    request_ids: refs?.request_ids ?? [],
  };
}
