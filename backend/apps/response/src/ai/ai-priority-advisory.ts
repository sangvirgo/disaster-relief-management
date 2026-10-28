import { riskAttentionLevel, type RiskAttentionLevel, type AiAssessmentFacts } from './ai-risk';
import { isAiAdvisoryFresh } from './ai-advisory-input';

const advisoryStatuses = ['QUEUED', 'PROCESSING', 'COMPLETED', 'SKIPPED', 'FAILED', 'STALE'] as const;
type AdvisoryStatus = (typeof advisoryStatuses)[number] | 'UNKNOWN';

export interface AiPriorityAdvisory {
  status: AdvisoryStatus;
  score: number | null;
  level: RiskAttentionLevel | null;
  reasons: string[];
  confidence: number | null;
  source: 'GEMINI' | 'DEMO_FIXTURE';
  human_review_required: true;
  review_status: string | null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function currentAiAdvisory(value: Record<string, unknown> | undefined, facts: AiAssessmentFacts, workCycle: number): Record<string, unknown> | null {
  if (!value) return null;
  if (isAiAdvisoryFresh(value, facts, workCycle)) return value;
  return { ...value, status: 'STALE', extracted_json: null, risk_score: null, reason_codes: [] };
}

export function aiPriorityAdvisory(value: unknown): AiPriorityAdvisory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const advisory = asObject(value);
  const extracted = asObject(advisory.extracted_json);
  const rawStatus = advisory.status;
  const status: AdvisoryStatus = advisoryStatuses.includes(rawStatus as typeof advisoryStatuses[number])
    ? rawStatus as typeof advisoryStatuses[number]
    : 'UNKNOWN';
  const rawScore = extracted.priority_score;
  const validScore = status === 'COMPLETED' && advisory.review_status !== 'REJECTED' && Number.isInteger(rawScore) && Number(rawScore) >= 0 && Number(rawScore) <= 100;
  const validReasons = Array.isArray(extracted.priority_reasons) && extracted.priority_reasons.length <= 6 &&
    extracted.priority_reasons.every((reason) => typeof reason === 'string' && reason.length > 0 && reason.length <= 160)
    ? extracted.priority_reasons as string[]
    : [];
  const reasons = status === 'COMPLETED' && advisory.review_status !== 'REJECTED' && (validScore || rawScore === null) ? validReasons : [];
  const rawConfidence = extracted.confidence;
  const confidence = validScore && typeof rawConfidence === 'number' && rawConfidence >= 0 && rawConfidence <= 1
    ? rawConfidence
    : null;

  return {
    status,
    score: validScore ? Number(rawScore) : null,
    level: validScore ? riskAttentionLevel(Number(rawScore)) : null,
    reasons,
    confidence,
    source: typeof advisory.model === 'string' && advisory.model.startsWith('demo-fixture:')
      ? 'DEMO_FIXTURE'
      : 'GEMINI',
    human_review_required: true,
    review_status: typeof advisory.review_status === 'string' ? advisory.review_status : null,
  };
}
