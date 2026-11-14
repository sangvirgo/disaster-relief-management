import { describe, expect, it } from '@jest/globals';
import { assessFastTrack, ruleAdvisory } from '../src/operations/request-operations.fast-track';
import type { AiPriorityAdvisory } from '../src/ai/ai-priority-advisory';

const facts = {
  incidentCategoryCode: 'FLOOD', description: 'Nước dâng nhanh, có trẻ em bị mắc kẹt', reporterDeclaredDanger: true,
  peopleAffected: 4, childrenCount: 2, elderlyCount: 0, needsRescue: true, needsReliefSupplies: false,
};
const clean = {
  status: 'SUBMITTED', reportMode: 'SELF', reviewLane: 'NORMAL', proxyFlagCount: 0, peopleAffected: 4,
  ruleAdvisory: ruleAdvisory(facts), aiAdvisory: null,
};
const ai = (level: AiPriorityAdvisory['level'], over: Partial<AiPriorityAdvisory> = {}): AiPriorityAdvisory => ({
  status: 'COMPLETED', score: 50, level, reasons: [], confidence: 0.8, source: 'GEMINI', human_review_required: true, review_status: null, ...over,
});

describe('assessFastTrack', () => {
  it('accepts a clean self report and suggests a priority from the rules engine', () => {
    const result = assessFastTrack(clean);
    expect(result.eligible).toBe(true);
    expect(result.suggested_priority).toMatch(/^P[1-4]$/);
    expect(result.sources).toEqual(['BACKEND_RULES']);
    expect(result.suggested_priority_basis).toBe('COMPLETE');
  });

  it.each([
    [{ reportMode: 'PROXY' }, 'PROXY_REPORT'],
    [{ reviewLane: 'RATE_LIMITED_REVIEW' }, 'REVIEW_LANE'],
    [{ proxyFlagCount: 1 }, 'PROXY_FLAGS'],
    [{ pendingSupplement: true }, 'PENDING_SUPPLEMENT'],
    [{ possibleDuplicate: true }, 'POSSIBLE_DUPLICATE'],
    [{ status: 'VERIFIED' }, 'STATE_NOT_FAST_TRACKABLE'],
  ])('blocks %j', (override, blocker) => {
    const result = assessFastTrack({ ...clean, ...override });
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain(blocker);
  });

  it('blocks when there is not enough data to suggest a priority', () => {
    const result = assessFastTrack({ ...clean, ruleAdvisory: { ...clean.ruleAdvisory, score: null, level: null } });
    expect(result.blockers).toContain('INSUFFICIENT_DATA');
    expect(result.eligible).toBe(false);
    expect(result.suggested_priority).toBe('P3');
    expect(result.suggestion_confidence).toBe('LOW');
  });

  it('lets a completed AI advisory raise urgency but never lower it', () => {
    const lowRule = { ...clean.ruleAdvisory, level: 'ELEVATED' as const };
    expect(assessFastTrack({ ...clean, ruleAdvisory: lowRule, aiAdvisory: ai('CRITICAL') }).suggested_priority).toBe('P1');
    expect(assessFastTrack({ ...clean, ruleAdvisory: lowRule, aiAdvisory: ai('STANDARD') }).suggested_priority).toBe('P3');
    const rejected = assessFastTrack({ ...clean, ruleAdvisory: lowRule, aiAdvisory: ai('CRITICAL', { review_status: 'REJECTED' }) });
    expect(rejected.suggested_priority).toBe('P3');
    expect(rejected.sources).toEqual(['BACKEND_RULES']);
    const pending = assessFastTrack({ ...clean, ruleAdvisory: lowRule, aiAdvisory: ai('CRITICAL', { status: 'QUEUED' }) });
    expect(pending.suggested_priority).toBe('P3');
  });

  it('never suggests below P2 for a declared life threat and blocks urgent medical text', () => {
    const lowRule = { ...clean.ruleAdvisory, level: 'STANDARD' as const };
    expect(assessFastTrack({ ...clean, ruleAdvisory: lowRule, declaredDanger: true }).suggested_priority).toBe('P2');
    expect(assessFastTrack({ ...clean, ruleAdvisory: lowRule, declaredDanger: false }).suggested_priority).toBe('P4');
    const medical = assessFastTrack({ ...clean, ruleAdvisory: { ...lowRule, reason_codes: ['URGENT_MEDICAL_REVIEW_REQUIRED'] }, aiAdvisory: ai('STANDARD') });
    expect(medical.blockers).toContain('URGENT_MEDICAL_REVIEW');
    expect(medical.suggested_priority).toBe('P2');
    expect(medical.eligible).toBe(false);
    const withAi = assessFastTrack({ ...clean, ruleAdvisory: { ...lowRule, score: null, level: null, reason_codes: ['URGENT_MEDICAL_REVIEW_REQUIRED'] }, aiAdvisory: ai('CRITICAL') });
    expect(withAi.suggested_priority).toBe('P1');
  });

  it('marks incomplete information when the headcount is unknown', () => {
    expect(assessFastTrack({ ...clean, peopleAffected: null }).suggested_priority_basis).toBe('INCOMPLETE_INFO');
  });
});
