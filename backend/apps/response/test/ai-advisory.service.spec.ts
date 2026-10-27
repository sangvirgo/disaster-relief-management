import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import type { DataSource } from 'typeorm';
import { AiAdvisoryService } from '../src/ai/ai-advisory.service';
import { aiInputHash } from '../src/ai/ai-risk';
import { aiAssessmentHash, enqueueAiAdvisory } from '../src/ai/ai-advisory-input';
const job = { id: '00000000-0000-4000-8000-000000000001', request_id: 'request', description: 'Cần nước uống', input_hash: aiInputHash('Cần nước uống'), model: 'test' };
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
    delete process.env.GEMINI_ADVISORY_WORKER_ENABLED;
  });
  it('does not claim jobs when the scheduler is disabled', async () => {
    process.env.GEMINI_ADVISORY_WORKER_ENABLED = 'false';
    const transaction = jest.fn();
    const worker = new AiAdvisoryService({ transaction } as unknown as DataSource);
    worker.onModuleInit(); await Promise.resolve(); worker.onModuleDestroy();
    expect(transaction).not.toHaveBeenCalled();
  });
  it('runs Gemini independently when other scheduled jobs are disabled', () => {
    process.env.SCHEDULER_ENABLED = 'false';
    process.env.GEMINI_ADVISORY_WORKER_ENABLED = 'true';
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
      const saved = JSON.parse(String(completed?.[1]?.[1])) as Record<string, unknown>;
      expect(saved.indicators).toEqual(fixture.expected);
      expect(saved.priority_score).toBe(fixture.value.priority_score);
    }
  });
  it('claims an actually enqueued hash and sends only structured input by default', async () => {
    process.env.GEMINI_API_KEY = 'unit-test';
    const facts = { version: 2, workCycle: 1, incidentCategoryCode: 'FLOOD', description: 'Bí mật cần giữ tại máy chủ',
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
  it('records provider failure with a safe code and job identifier', async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const worker = new AiAdvisoryService({ query } as unknown as DataSource);
    jest.spyOn(worker as unknown as { claimJob(): Promise<typeof job> }, 'claimJob').mockResolvedValue(job);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('key=secret and private description'));
    await worker['processOne']();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status='FAILED'"), [job.id, 'AI_PROVIDER_ERROR']);
    expect(Logger.prototype.warn).toHaveBeenCalledWith('AI_PROVIDER_ERROR', `job:${job.id}`);
    expect(JSON.stringify(jest.mocked(Logger.prototype.warn).mock.calls)).not.toContain('secret');
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
    expect(query).toHaveBeenNthCalledWith(1, expect.stringMatching(/status='FAILED'.*status='PROCESSING'.*lease_until<now\(\)/));
    expect(query).toHaveBeenNthCalledWith(2, expect.stringMatching(/a.status='QUEUED'.*a.attempts=0/s));
  });
});
