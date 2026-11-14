import type { EntityManager } from 'typeorm';
import type { Grant } from '@c48/identity-contracts/permissions';
import { requestScopeFilter } from '../requests/request-scope';
import { riskAttentionLevel, scoreRequestRisk } from '../ai/ai-risk';
import type { RiskAttentionLevel, RiskFacts } from '../ai/ai-risk';
import type { AiPriorityAdvisory } from '../ai/ai-priority-advisory';

export type FastTrackBlocker =
  | 'STATE_NOT_FAST_TRACKABLE'
  | 'PROXY_REPORT'
  | 'REVIEW_LANE'
  | 'PROXY_FLAGS'
  | 'INSUFFICIENT_DATA'
  | 'URGENT_MEDICAL_REVIEW'
  | 'PENDING_SUPPLEMENT'
  | 'POSSIBLE_DUPLICATE';

export interface RuleAdvisory extends Record<string, unknown> {
  outcome: 'INSUFFICIENT_DATA' | 'SUGGESTION';
  score: number | null;
  level: RiskAttentionLevel | null;
  reason_codes: string[];
  source: 'BACKEND_RULES';
  rules_version: string;
}

export interface FastTrackAssessment {
  eligible: boolean;
  blockers: FastTrackBlocker[];
  /** Always present: a recommendation only. Whether it can be confirmed in one step is `eligible`. */
  suggested_priority: 'P1' | 'P2' | 'P3' | 'P4';
  /** LOW = no scoring signal; shown as a provisional flag the coordinator must review. */
  suggestion_confidence: 'NORMAL' | 'LOW';
  suggested_priority_basis: 'COMPLETE' | 'INCOMPLETE_INFO';
  sources: Array<'BACKEND_RULES' | 'AI'>;
  reason_codes: string[];
}

export interface FastTrackInput {
  status: string;
  reportMode: string;
  reviewLane: string;
  proxyFlagCount: number;
  peopleAffected: number | null;
  declaredDanger?: boolean;
  ruleAdvisory: RuleAdvisory;
  aiAdvisory: AiPriorityAdvisory | null;
  pendingSupplement?: boolean;
  possibleDuplicate?: boolean;
}

const levelPriority: Record<RiskAttentionLevel, 'P1' | 'P2' | 'P3' | 'P4'> = {
  CRITICAL: 'P1', HIGH: 'P2', ELEVATED: 'P3', STANDARD: 'P4',
};

export function ruleAdvisory(facts: RiskFacts): RuleAdvisory {
  const risk = scoreRequestRisk(facts);
  return {
    outcome: risk.score === null ? 'INSUFFICIENT_DATA' : 'SUGGESTION',
    score: risk.score,
    level: riskAttentionLevel(risk.score),
    reason_codes: risk.reasonCodes,
    source: 'BACKEND_RULES',
    rules_version: 'v3',
  };
}

/**
 * Deterministic, explainable suggestion. The rules engine is the baseline; a current, completed and
 * not-rejected AI advisory can only make the suggestion MORE urgent, never less. The result is a
 * suggestion: a coordinator must still confirm it and remains the decision maker.
 */
export function assessFastTrack(input: FastTrackInput): FastTrackAssessment {
  const blockers: FastTrackBlocker[] = [];
  if (!['SUBMITTED', 'VERIFYING'].includes(input.status)) blockers.push('STATE_NOT_FAST_TRACKABLE');
  if (input.reportMode !== 'SELF') blockers.push('PROXY_REPORT');
  if (input.reviewLane !== 'NORMAL') blockers.push('REVIEW_LANE');
  if (input.proxyFlagCount > 0) blockers.push('PROXY_FLAGS');
  if (input.pendingSupplement) blockers.push('PENDING_SUPPLEMENT');
  if (input.possibleDuplicate) blockers.push('POSSIBLE_DUPLICATE');

  const levels: Array<{ source: 'BACKEND_RULES' | 'AI'; level: RiskAttentionLevel }> = [];
  if (input.ruleAdvisory.level) levels.push({ source: 'BACKEND_RULES', level: input.ruleAdvisory.level });
  const ai = input.aiAdvisory;
  if (ai && ai.status === 'COMPLETED' && ai.review_status !== 'REJECTED' && ai.level) {
    levels.push({ source: 'AI', level: ai.level });
  }
  if (input.ruleAdvisory.reason_codes.includes('URGENT_MEDICAL_REVIEW_REQUIRED')) blockers.push('URGENT_MEDICAL_REVIEW');
  if (!levels.length) blockers.push('INSUFFICIENT_DATA');
  const rank = (level: RiskAttentionLevel) => Number(levelPriority[level].slice(1));
  const best = levels.reduce<typeof levels[number] | null>((current, item) => !current || rank(item.level) < rank(current.level) ? item : current, null);
  // A declared life threat or urgent-medical wording is never suggested below P2; with no signal at all
  // the provisional flag is P3 (never silently P4) and marked LOW confidence.
  const urgent = Boolean(input.declaredDanger) || input.ruleAdvisory.reason_codes.includes('URGENT_MEDICAL_REVIEW_REQUIRED');
  const base = best ? levelPriority[best.level] : 'P3';
  const suggested = urgent && Number(base.slice(1)) > 2 ? 'P2' : base;
  return {
    eligible: blockers.length === 0,
    blockers,
    suggested_priority: suggested,
    suggestion_confidence: best ? 'NORMAL' : 'LOW',
    suggested_priority_basis: input.peopleAffected == null ? 'INCOMPLETE_INFO' : 'COMPLETE',
    sources: [...new Set(levels.map((item) => item.source))],
    reason_codes: input.ruleAdvisory.reason_codes,
  };
}

/** Nearby in-scope open reports of the same incident type; a coordinator must compare these. */
export async function hasPossibleDuplicate(manager: Pick<EntityManager, 'query'>, requestId: string, grants: readonly Grant[]): Promise<boolean> {
  const values: unknown[] = [requestId];
  const candidateScope = requestScopeFilter(grants, 'REQUEST_VERIFY', values, 'candidate');
  const rows = await manager.query(
    `SELECT 1
       FROM assistance_request target JOIN request_subject ts ON ts.request_id=target.id
       JOIN assistance_request candidate ON candidate.id<>target.id
       JOIN request_subject cs ON cs.request_id=candidate.id
      WHERE target.id=$1 AND ${candidateScope}
        AND candidate.status NOT IN ('DUPLICATE','REJECTED','CANCELLED','CLOSED','RESOLVED')
        AND candidate.incident_category_code=target.incident_category_code
        AND candidate.received_at BETWEEN target.received_at-interval '24 hours' AND target.received_at+interval '24 hours'
        AND ST_DWithin(ts.location,cs.location,1000)
      LIMIT 1`, values,
  ) as unknown[];
  return rows.length > 0;
}
