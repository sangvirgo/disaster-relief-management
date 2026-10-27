import { jest } from '@jest/globals';
import { aiAssessmentHash, enqueueAiAdvisory, isAiAdvisoryFresh } from '../src/ai/ai-advisory-input';
import { buildAiAssessmentInput } from '../src/ai/ai-risk';
import { RequestOperationsAiAdvisoryService } from '../src/operations/request-operations.ai-advisory.service';

const facts = { version: 4, workCycle: 1, incidentCategoryCode: 'FLOOD', description: 'Nước đang dâng.',
  peopleAffected: 1, childrenCount: null, elderlyCount: null, reporterDeclaredDanger: true, needsRescue: true, needsReliefSupplies: false };

describe('advisory input identity and review', () => {
  afterEach(() => {
    delete process.env.GEMINI_INCLUDE_SYNTHETIC_DEMO_NARRATIVE;
    delete process.env.GEMINI_API_KEY;
  });

  it('keeps narrative out of the default provider input and changes identity for explicit demo narrative', () => {
    const defaultHash = aiAssessmentHash(facts, 4, 1);
    expect(buildAiAssessmentInput(facts).description).toBe('');
    process.env.GEMINI_INCLUDE_SYNTHETIC_DEMO_NARRATIVE = 'true';
    expect(buildAiAssessmentInput(facts).description).toBe('Nước đang dâng.');
    expect(aiAssessmentHash(facts, 4, 1)).not.toBe(defaultHash);
  });

  it('distinguishes A → B → A and reopened work cycles while tolerating unrelated request-version bumps', () => {
    const a = aiAssessmentHash(facts, 4, 1);
    const b = aiAssessmentHash({ ...facts, peopleAffected: 20 }, 5, 1);
    const laterVersion = { ...facts, version: 8 };
    expect(new Set([a, b, aiAssessmentHash(facts, 6, 1)]).size).toBe(3);
    expect(isAiAdvisoryFresh({ input_hash: a, request_version: 4 }, laterVersion, 1)).toBe(true);
    expect(isAiAdvisoryFresh({ input_hash: a, request_version: 4 }, facts, 2)).toBe(false);
    expect(isAiAdvisoryFresh({ input_hash: a, request_version: 4 }, { ...facts, description: 'Có người bất tỉnh.' }, 1)).toBe(true);
  });

  it('invalidates a narrative-enabled advisory when the synthetic description changes', () => {
    process.env.GEMINI_INCLUDE_SYNTHETIC_DEMO_NARRATIVE = 'true';
    const inputHash = aiAssessmentHash(facts, 4, 1);
    expect(isAiAdvisoryFresh({ input_hash: inputHash, request_version: 4 }, { ...facts, description: 'Có người bất tỉnh.' }, 1)).toBe(false);
  });

  it('enqueues the exact persisted structured facts including sticky danger and category', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT r.version') ? [facts] : []);
    await enqueueAiAdvisory({ query } as never, 'request');
    expect(query.mock.calls[1]?.[0]).toContain('INSERT INTO ai_advisory');
    expect(query.mock.calls[1]?.[0]).toContain("'v3','v4'");
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

  it('manually queues a fresh failed advisory, resets its retry budget, and records a staff audit event', async () => {
    process.env.GEMINI_API_KEY = 'unit-test';
    const session = { userId: 'coordinator' };
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
      queries.push({ sql, parameters });
      if (sql.includes('FROM ai_advisory')) return [{ id: 'advisory', status: 'FAILED', review_status: null,
        request_version: 4, input_hash: aiAssessmentHash(facts, 4, 1), latest_id: 'advisory', attempts: 3 }];
      if (sql.includes('SELECT r.version')) return [facts];
      if (sql.includes('INSERT INTO request_event')) return [{ id: 'retry-event' }];
      if (sql.includes('UPDATE ai_advisory')) return [{ id: 'advisory' }];
      return [];
    });
    const manager = { query };
    const execute = jest.fn(async (_source: unknown, command: { scopeKey: string; command: string; key: string; requestHash: string;
      execute: (manager: unknown) => Promise<{ status: number; value: Record<string, unknown>; resource: unknown }> }) => ({
      ...(await command.execute(manager)), replay: false,
    }));
    const staffRequest = jest.fn(async () => ({ version: 4 }));
    const service = new RequestOperationsAiAdvisoryService({} as never,
      { execute } as never,
      { require: async () => session } as never,
      { staffRequest } as never);
    const retry = (service as unknown as { retry: (requestId: string, advisoryId: string, dto: { expected_version: number }, key: string, request: unknown) => Promise<{ status: number; value: Record<string, unknown>; replay: boolean }> }).retry;

    const result = await retry.call(service, 'request', 'advisory', { expected_version: 4 }, 'idempotency-key', {});

    expect(result).toMatchObject({ status: 202, value: { request_id: 'request', advisory_id: 'advisory', status: 'QUEUED' }, replay: false });
    expect(execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scopeKey: 'response.request-ai-retry:request:coordinator',
      command: 'response.requests.retry-ai-advisory',
      key: 'idempotency-key',
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    }));
    expect(staffRequest).toHaveBeenCalledWith(manager, 'request', session, 'REQUEST_VERIFY', true);
    const reset = queries.find(({ sql }) => sql.includes('UPDATE ai_advisory'));
    expect(reset?.sql).toMatch(/status='QUEUED'/u);
    expect(reset?.sql).toMatch(/attempts=0/u);
    expect(reset?.sql).toMatch(/claim_token=NULL/u);
    const audit = queries.find(({ sql }) => sql.includes('INSERT INTO request_event'));
    expect(audit?.sql).toContain('AI_ADVISORY_RETRY');
    expect(JSON.parse(String(audit?.parameters[2]))).toMatchObject({ advisory_id: 'advisory', previous_attempts: 3 });
  });

  it.each([
    { status: 'QUEUED', latest: 'advisory', stale: false },
    { status: 'COMPLETED', latest: 'advisory', stale: false },
    { status: 'FAILED', latest: 'newer-advisory', stale: false },
    { status: 'FAILED', latest: 'advisory', stale: true },
  ])('rejects manual retry for non-failed, superseded, or stale advisory ($status)', async ({ status, latest, stale }) => {
    process.env.GEMINI_API_KEY = 'unit-test';
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM ai_advisory')) return [{ id: 'advisory', status, review_status: null,
        request_version: 4, input_hash: aiAssessmentHash(stale ? { ...facts, peopleAffected: 20 } : facts, 4, 1), latest_id: latest, attempts: 2 }];
      if (sql.includes('SELECT r.version')) return [facts];
      return [];
    });
    const service = new RequestOperationsAiAdvisoryService({} as never,
      { execute: async (_source: unknown, command: { execute: (manager: unknown) => Promise<unknown> }) => command.execute({ query }) } as never,
      { require: async () => ({ userId: 'coordinator' }) } as never,
      { staffRequest: async () => ({ version: 4 }) } as never);
    const retry = (service as unknown as { retry: (requestId: string, advisoryId: string, dto: { expected_version: number }, key: string, request: unknown) => Promise<unknown> }).retry;

    await expect(retry.call(service, 'request', 'advisory', { expected_version: 4 }, 'key', {})).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)/u.test(sql))).toBe(false);
  });

  it('rejects manual retry when Gemini is disabled', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM ai_advisory')) return [{ id: 'advisory', status: 'FAILED', review_status: null,
        request_version: 4, input_hash: aiAssessmentHash(facts, 4, 1), latest_id: 'advisory', attempts: 2 }];
      if (sql.includes('SELECT r.version')) return [facts];
      return [];
    });
    const service = new RequestOperationsAiAdvisoryService({} as never,
      { execute: async (_source: unknown, command: { execute: (manager: unknown) => Promise<unknown> }) => command.execute({ query }) } as never,
      { require: async () => ({ userId: 'coordinator' }) } as never,
      { staffRequest: async () => ({ version: 4 }) } as never);
    const retry = (service as unknown as { retry: (requestId: string, advisoryId: string, dto: { expected_version: number }, key: string, request: unknown) => Promise<unknown> }).retry;

    await expect(retry.call(service, 'request', 'advisory', { expected_version: 4 }, 'key', {})).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)/u.test(sql))).toBe(false);
  });
});
