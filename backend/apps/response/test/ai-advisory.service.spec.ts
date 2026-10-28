import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import type { DataSource } from 'typeorm';
import { AiAdvisoryService } from '../src/ai/ai-advisory.service';
import { aiInputHash } from '../src/ai/ai-risk';
import { aiAssessmentHash, enqueueAiAdvisory } from '../src/ai/ai-advisory-input';
const job = { id: '00000000-0000-4000-8000-000000000001', request_id: 'request', description: 'Cần nước uống', input_hash: aiInputHash('Cần nước uống'), model: 'test', attempts: 1, claim_token: '00000000-0000-4000-8000-000000000099' };
const extraction = {
  summary: 'Cần nước uống', indicators: [], facts: {}, confidence: 0.5,
  priority_score: 82, priority_reasons: ['Có người cần cứu hộ khẩn cấp.'],
};
const capturedGeminiResponse = JSON.parse(readFileSync(
  new URL('../../../../docs/backend/seed/fixtures/gemini-af1-f9-response-2026-10-27.json', import.meta.url), 'utf8',
)).extracted_json as Record<string, unknown>;
const capturedTrappedGeminiResponse = JSON.parse(readFileSync(
  new URL('../../../../docs/backend/seed/fixtures/gemini-af2-f6-response-2026-10-27.json', import.meta.url), 'utf8',
)).extracted_json as Record<string, unknown>;
describe('AI advisory worker lifecycle', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.SCHEDULER_ENABLED;
    delete process.env.GEMINI_MAX_RETRIES;
    delete process.env.GEMINI_INCLUDE_SYNTHETIC_DEMO_NARRATIVE;
  });
  it('claims AI jobs when other schedulers are disabled', () => {
    process.env.SCHEDULER_ENABLED = 'false';
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const transaction = jest.fn((work: (manager: { query: typeof query }) => Promise<unknown>) => work({ query }));
    const worker = new AiAdvisoryService({ transaction } as unknown as DataSource);
    worker.onModuleInit(); worker.onModuleDestroy();
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('requires a bounded priority assessment in Gemini output', () => {
    const worker = new AiAdvisoryService({} as DataSource);
    expect(worker['validExtraction'](extraction)).toBe(true);
    expect(worker['validExtraction']({ ...extraction, priority_score: 101 })).toBe(false);
    expect(worker['validExtraction']({ ...extraction, priority_score: undefined })).toBe(false);
    expect(worker['validExtraction']({ ...extraction, indicators: ['FIRE'] })).toBe(false);
    expect(worker['validExtraction']({ ...extraction, priority_reasons: ['x'.repeat(161)] })).toBe(false);
    expect(worker['validExtraction']({ ...extraction, priority_score: null, priority_reasons: ['Chưa đủ dữ kiện để đánh giá.'] })).toBe(true);
  });
  it('normalizes known Gemini indicator codes into Vietnamese for both SOS fixtures', async () => {
    process.env.GEMINI_API_KEY = 'unit-test';
    const fetch = jest.spyOn(globalThis, 'fetch');
    const fixtures = [
      { value: capturedGeminiResponse, expected: ['Cháy', 'Cần cứu hộ', 'Có trẻ em', 'Có người cao tuổi'] },
      { value: capturedTrappedGeminiResponse, expected: ['Có người mắc kẹt', 'Cần cứu hộ', 'Cần hàng cứu trợ', 'Có trẻ em', 'Có người cao tuổi'] },
    ];

    for (const fixture of fixtures) {
      const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
      const worker = new AiAdvisoryService({ query } as unknown as DataSource);
      jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue(job);
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(fixture.value) }] } }] }),
      } as Response);

      await worker['processOne']();

      expect(fetch).toHaveBeenCalledTimes(fixtures.indexOf(fixture) + 1);
      const completed = query.mock.calls.find(([sql]) => String(sql).includes("status='COMPLETED'"));
      expect(completed).toBeDefined();
      expect(String(completed?.[0])).toContain('claim_token=$3');
      expect(completed?.[1]?.[2]).toBe(job.claim_token);
      const saved = JSON.parse(String(completed?.[1]?.[1])) as Record<string, unknown>;
      expect(saved.indicators).toEqual(fixture.expected);
      expect(saved.priority_score).toBe(fixture.value.priority_score);
    }
  });
  it('claims an actually enqueued hash and sends structured facts without narrative by default', async () => {
    process.env.GEMINI_API_KEY = 'unit-test';
    const facts = { version: 2, workCycle: 1, incidentCategoryCode: 'FLOOD', description: 'Nước lũ dâng nhanh; 4 người mắc kẹt.',
      peopleAffected: 3, childrenCount: 1, elderlyCount: 0, reporterDeclaredDanger: true, needsRescue: true, needsReliefSupplies: false };
    let inputHash = '';
    const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes('SELECT r.version')) return [facts];
      if (sql.includes('INSERT INTO ai_advisory')) { inputHash = String(parameters[2]); return []; }
      if (sql.includes('SELECT a.id')) return [{ ...job, ...facts, request_version: 2, latest_id: job.id, input_hash: inputHash }];
      if (sql.includes('INSERT INTO ai_daily_usage')) return [{ calls: 1 }];
      return [];
    });
    await enqueueAiAdvisory({ query } as never, job.request_id);
    const worker = new AiAdvisoryService({ query, transaction: async (work: (manager: unknown) => Promise<unknown>) => work({ query }) } as never);
    const extract = jest.spyOn(worker as unknown as { extract(job: unknown, text: string): Promise<typeof extraction> }, 'extract').mockResolvedValue(extraction);
    await worker['processOne']();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(JSON.parse(extract.mock.calls[0]![1])).toMatchObject({ incident_category_code: 'FLOOD', reporter_declared_danger: true, description: '' });
    expect(extract.mock.calls[0]![1]).not.toContain(facts.description);
    expect(inputHash).toBe(aiAssessmentHash(facts, 2, 1));
  });
  it('sends only sanitized narrative when the synthetic-demo flag is explicitly enabled', async () => {
    process.env.GEMINI_API_KEY = 'unit-test';
    process.env.GEMINI_INCLUDE_SYNTHETIC_DEMO_NARRATIVE = 'true';
    const facts = { version: 2, workCycle: 1, incidentCategoryCode: 'FLOOD', description: 'Tôi tên Nguyễn Văn An, số điện thoại 0912345678; nước lũ dâng nhanh.',
      peopleAffected: 3, childrenCount: 1, elderlyCount: 0, reporterDeclaredDanger: true, needsRescue: true, needsReliefSupplies: false };
    let inputHash = '';
    const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes('SELECT r.version')) return [facts];
      if (sql.includes('INSERT INTO ai_advisory')) { inputHash = String(parameters[2]); return []; }
      if (sql.includes('SELECT a.id')) return [{ ...job, ...facts, request_version: 2, latest_id: job.id, input_hash: inputHash }];
      if (sql.includes('INSERT INTO ai_daily_usage')) return [{ calls: 1 }];
      return [];
    });
    await enqueueAiAdvisory({ query } as never, job.request_id);
    const worker = new AiAdvisoryService({ query, transaction: async (work: (manager: unknown) => Promise<unknown>) => work({ query }) } as never);
    const extract = jest.spyOn(worker as unknown as { extract(job: unknown, text: string): Promise<typeof extraction> }, 'extract').mockResolvedValue(extraction);
    await worker['processOne']();
    expect(JSON.parse(extract.mock.calls[0]![1]).description).toContain('[đã ẩn tên]');
    expect(extract.mock.calls[0]![1]).not.toContain('Nguyễn Văn An');
    expect(extract.mock.calls[0]![1]).not.toContain('0912345678');
    expect(inputHash).toBe(aiAssessmentHash(facts, 2, 1));
  });
  it('logs claim failure without database details and can run again', async () => {
    const transaction = jest.fn<() => Promise<undefined>>().mockRejectedValueOnce(new Error('secret connection string')).mockResolvedValueOnce(undefined);
    const worker = new AiAdvisoryService({ transaction } as unknown as DataSource);
    await worker['processOne'](); await worker['processOne']();
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.warn).toHaveBeenCalledWith('AI_ADVISORY_CLAIM_FAILED');
    expect(JSON.stringify(jest.mocked(Logger.prototype.warn).mock.calls)).not.toContain('secret');
  });
  it('retries network failures with a safe status and job identifier', async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const worker = new AiAdvisoryService({ query } as unknown as DataSource);
    jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue(job);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('key=secret and private description'));
    await worker['processOne']();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='QUEUED'"), [job.id, 30, job.claim_token]);
    expect(String(query.mock.calls[0]?.[0])).toContain('claim_token=$3');
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'AI_PROVIDER_RETRY_SCHEDULED',
      `job:${job.id} attempt:1 delay_seconds:30 provider_status:NETWORK`,
    );
    expect(JSON.stringify(jest.mocked(Logger.prototype.warn).mock.calls)).not.toContain('secret');
  });
  it.each([{ attempts: 1, delaySeconds: 30 }, { attempts: 2, delaySeconds: 120 }, { attempts: 3, delaySeconds: 480 }])(
    'requeues a transient Gemini failure after attempt $attempts with a $delaySeconds second delay', async ({ attempts, delaySeconds }) => {
      const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
      const worker = new AiAdvisoryService({ query } as unknown as DataSource);
      jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue({ ...job, attempts });
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);

      await worker['processOne']();

      expect(query).toHaveBeenCalledWith(expect.stringContaining("status='QUEUED'"), [job.id, delaySeconds, job.claim_token]);
      expect(query.mock.calls.some(([sql]) => String(sql).includes("status='FAILED'"))).toBe(false);
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'AI_PROVIDER_RETRY_SCHEDULED',
        `job:${job.id} attempt:${attempts} delay_seconds:${delaySeconds} provider_status:503`,
      );
    },
  );
  it('fails after the configured three retries are exhausted', async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const worker = new AiAdvisoryService({ query } as unknown as DataSource);
    jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue({ ...job, attempts: 4 });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);

    await worker['processOne']();

    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='FAILED'"), [job.id, 'AI_PROVIDER_ERROR', job.claim_token]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status='QUEUED'"))).toBe(false);
  });
  it('uses GEMINI_MAX_RETRIES to limit attempts after the initial provider call', async () => {
    process.env.GEMINI_MAX_RETRIES = '1';
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const worker = new AiAdvisoryService({ query } as unknown as DataSource);
    jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue({ ...job, attempts: 2 });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);

    await worker['processOne']();

    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='FAILED'"), [job.id, 'AI_PROVIDER_ERROR', job.claim_token]);
  });
  it('does not retry permanent Gemini client errors', async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const worker = new AiAdvisoryService({ query } as unknown as DataSource);
    jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue(job);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400 } as Response);

    await worker['processOne']();

    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='FAILED'"), [job.id, 'AI_PROVIDER_ERROR', job.claim_token]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status='QUEUED'"))).toBe(false);
  });
  it('defers queued advisories until the next local day when the provider-call cap is reached', async () => {
    process.env.GEMINI_API_KEY = 'unit-test';
    const facts = { version: 2, workCycle: 1, incidentCategoryCode: 'FLOOD', description: 'Bí mật cần giữ tại máy chủ',
      peopleAffected: 3, childrenCount: 1, elderlyCount: 0, reporterDeclaredDanger: true, needsRescue: true, needsReliefSupplies: false };
    const queuedJob = { ...job, attempts: 4, input_hash: aiAssessmentHash(facts, 2, 1), request_version: 2, latest_id: job.id,
      workCycle: 1, incidentCategoryCode: 'FLOOD', description: facts.description, peopleAffected: 3, childrenCount: 1,
      elderlyCount: 0, reporterDeclaredDanger: true, needsRescue: true, needsReliefSupplies: false };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT a.id')) return [queuedJob];
      if (sql.includes('INSERT INTO ai_daily_usage')) return [];
      return [];
    });
    const transaction = async (work: (manager: { query: typeof query }) => Promise<unknown>) => work({ query });
    const worker = new AiAdvisoryService({ query, transaction } as unknown as DataSource);
    const fetch = jest.spyOn(globalThis, 'fetch');

    await worker['processOne']();

    const deferral = query.mock.calls.find(([sql]) => sql.includes("AT TIME ZONE 'America/Los_Angeles'"));
    expect(deferral?.[0]).toContain("status='QUEUED'");
    expect(deferral?.[1]).toEqual([job.id]);
    expect(fetch).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith('AI_DAILY_LIMIT_RETRY_SCHEDULED', `job:${job.id}`);
  });
  it('retries result persistence without repeating the provider call', async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockRejectedValueOnce(new Error('DB unavailable')).mockResolvedValueOnce([]);
    const worker = new AiAdvisoryService({ query } as unknown as DataSource);
    jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue(job);
    const extract = jest.spyOn(worker as unknown as { extract(): Promise<typeof extraction> }, 'extract').mockResolvedValue(extraction);
    await worker['processOne']();
    expect(query).toHaveBeenCalledTimes(2); expect(extract).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith('AI_ADVISORY_PERSIST_FAILED', `job:${job.id}`);
  });
  it('bounds persistence retries and leaves the durable lease for recovery', async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockRejectedValue(new Error('DB credentials'));
    const worker = new AiAdvisoryService({ query } as unknown as DataSource);
    jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue(job);
    jest.spyOn(worker as unknown as { extract(): Promise<typeof extraction> }, 'extract').mockResolvedValue(extraction);
    await expect(worker['processOne']()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.every(([sql]) => String(sql).includes("status='COMPLETED'"))).toBe(true);
    expect(JSON.stringify(jest.mocked(Logger.prototype.warn).mock.calls)).not.toContain('credentials');
  });
  it('recovers expired leases before claiming and preserves the one-call bound', async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const transaction = async (work: (manager: unknown) => Promise<unknown>) => work({ query });
    const worker = new AiAdvisoryService({ transaction } as unknown as DataSource);
    await worker['processOne']();
    expect(query.mock.calls[0]?.[0]).toMatch(/status=CASE.*claim_token=NULL.*status='PROCESSING'.*lease_until<now\(\)/s);
    expect(query.mock.calls[0]?.[1]).toEqual([3]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringMatching(/a.status='QUEUED'.*a.lease_until IS NULL.*a.lease_until<=now\(\)/s));
  });
  it('reclaims an expired job with a new claim token and increments the provider-attempt count', async () => {
    process.env.GEMINI_API_KEY = 'unit-test';
    const facts = { version: 2, workCycle: 1, incidentCategoryCode: 'FLOOD', description: 'Không gửi mặc định',
      peopleAffected: 3, childrenCount: 1, elderlyCount: 0, reporterDeclaredDanger: true, needsRescue: true, needsReliefSupplies: false };
    const candidate = { ...job, ...facts, attempts: 1, request_version: 2, latest_id: job.id,
      input_hash: aiAssessmentHash(facts, 2, 1) };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT a.id')) return [candidate];
      if (sql.includes('INSERT INTO ai_daily_usage')) return [{ calls: 1 }];
      return [];
    });
    const worker = new AiAdvisoryService({ query, transaction: async (work: (manager: { query: typeof query }) => Promise<unknown>) => work({ query }) } as never);

    const claimed = await worker['claimJob']();

    expect(claimed).toMatchObject({ id: job.id, attempts: 2 });
    expect(claimed?.claim_token).toMatch(/^[0-9a-f-]{36}$/u);
    const claim = query.mock.calls.find(([sql]) => String(sql).includes('attempts=attempts+1'));
    expect(claim?.[0]).toContain('claim_token=$2');
    expect(claim?.[1]).toEqual([job.id, claimed?.claim_token]);
  });
});
