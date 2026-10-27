import { jest } from '@jest/globals';
import { aiAssessmentHash, enqueueAiAdvisory, isAiAdvisoryFresh } from '../src/ai/ai-advisory-input';
import { RequestOperationsAiAdvisoryService } from '../src/operations/request-operations.ai-advisory.service';

const facts = { version: 4, workCycle: 1, incidentCategoryCode: 'FLOOD', description: 'Nước đang dâng.',
  peopleAffected: 1, childrenCount: null, elderlyCount: null, reporterDeclaredDanger: true, needsRescue: true, needsReliefSupplies: false };

describe('advisory input identity and review', () => {
  it('distinguishes A → B → A and reopened work cycles while tolerating unrelated request-version bumps', () => {
    const a = aiAssessmentHash(facts, 4, 1);
    const b = aiAssessmentHash({ ...facts, peopleAffected: 20 }, 5, 1);
    const laterVersion = { ...facts, version: 8 };
    expect(new Set([a, b, aiAssessmentHash(facts, 6, 1)]).size).toBe(3);
    expect(isAiAdvisoryFresh({ input_hash: a, request_version: 4 }, laterVersion, 1)).toBe(true);
    expect(isAiAdvisoryFresh({ input_hash: a, request_version: 4 }, facts, 2)).toBe(false);
    expect(isAiAdvisoryFresh({ input_hash: a, request_version: 4 }, { ...facts, description: 'Có người bất tỉnh.' }, 1)).toBe(false);
  });

  it('enqueues the exact persisted structured facts including sticky danger and category', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT r.version') ? [facts] : []);
    await enqueueAiAdvisory({ query } as never, 'request');
    expect(query.mock.calls[1]?.[0]).toContain('INSERT INTO ai_advisory');
    expect((query.mock.calls[1] as unknown as [string, unknown[]])[1].slice(0, 3)).toEqual(['request', 4, aiAssessmentHash(facts, 4, 1)]);
  });

  it('defaults new advisory jobs to Gemini 3.5 Flash-Lite', async () => {
    const previousModel = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    try {
      const query = jest.fn(async (sql: string) => sql.includes('SELECT r.version') ? [facts] : []);
      await enqueueAiAdvisory({ query } as never, 'request');
      expect((query.mock.calls[1] as unknown as [string, unknown[]])[1][3]).toBe('gemini-3.5-flash-lite');
    } finally {
      if (previousModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = previousModel;
    }
  });

  it.each(['changed', 'superseded', 'version', 'cycle'])('rejects %s advisory review before writing history', async (condition) => {
    const advisory = { id: 'advisory', status: 'COMPLETED', review_status: null, request_version: 4,
      input_hash: aiAssessmentHash(condition === 'changed' ? { ...facts, peopleAffected: 20 } : facts, 4, 1),
      latest_id: condition === 'superseded' ? 'newer-advisory' : 'advisory' };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT r.version')) return [{ ...facts, workCycle: condition === 'cycle' ? 2 : 1 }];
      if (sql.includes('FROM ai_advisory')) return [advisory];
      return [{ id: 'event' }];
    });
    const service = new RequestOperationsAiAdvisoryService({} as never,
      { execute: async (_source: unknown, command: { execute: (manager: unknown) => Promise<unknown> }) => command.execute({ query }) } as never,
      { require: async () => ({ userId: 'coordinator' }) } as never,
      { staffRequest: async () => ({ version: 4, work_cycle: 1 }) } as never);
    await expect(service.review('request', 'advisory', { expected_version: condition === 'version' ? 3 : 4, decision: 'ACCEPTED' } as never, 'key', {} as never))
      .rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)/u.test(sql))).toBe(false);
  });
});
