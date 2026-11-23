import { describe, expect, it, jest } from '@jest/globals';
import { Registry } from 'prom-client';
import type { DataSource } from 'typeorm';
import { registerAiMetrics } from '../src/metrics/ai-metrics';

describe('AI metrics', () => {
  it('exposes the daily usage, the limit and the advisory queue, and queries once per scrape', async () => {
    const query = jest.fn(async (sql: string) => (sql.includes('ai_daily_usage') ? [{ calls: 42 }] : [{ status: 'QUEUED', total: 3 }, { status: 'FAILED', total: 1 }]));
    const registry = new Registry();
    registerAiMetrics(registry, { query } as unknown as DataSource, { GEMINI_DAILY_CALL_LIMIT: '500' });
    const body = await registry.metrics();
    expect(body).toContain('c48_ai_daily_calls 42');
    expect(body).toContain('c48_ai_daily_call_limit 500');
    expect(body).toContain('c48_ai_advisory_requests{status="QUEUED"} 3');
    expect(body).toContain('c48_ai_advisory_requests{status="FAILED"} 1');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reports a zero limit when none is configured and survives a database error', async () => {
    const registry = new Registry();
    registerAiMetrics(registry, { query: async () => { throw new Error('down'); } } as unknown as DataSource, {});
    const body = await registry.metrics();
    expect(body).toContain('c48_ai_daily_call_limit 0');
    expect(body).not.toContain('c48_ai_advisory_requests{');
  });
});
