import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { AiAdvisoryService } from '../src/ai/ai-advisory.service';
import { aiInputHash } from '../src/ai/ai-risk';
const job = { id: '00000000-0000-4000-8000-000000000001', request_id: 'request', description: 'Cần nước uống', input_hash: aiInputHash('Cần nước uống'), model: 'test' };
const extraction = { summary: 'Cần nước uống', indicators: [], facts: {}, confidence: 0.5 };
describe('AI advisory worker lifecycle', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { jest.restoreAllMocks(); delete process.env.GEMINI_API_KEY; delete process.env.SCHEDULER_ENABLED; });
  it('does not claim jobs when the scheduler is disabled', async () => {
    process.env.SCHEDULER_ENABLED = 'false';
    const transaction = jest.fn();
    const worker = new AiAdvisoryService({ transaction } as unknown as DataSource);
    worker.onModuleInit(); await Promise.resolve(); worker.onModuleDestroy();
    expect(transaction).not.toHaveBeenCalled();
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
