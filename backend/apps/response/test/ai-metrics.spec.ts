import { describe, expect, it, jest } from '@jest/globals';
import { Registry } from 'prom-client';
import type { DataSource } from 'typeorm';
import { registerAiMetrics } from '../src/metrics/ai-metrics';

describe('AI metrics', () => {
  it('exposes the daily usage, the limit and the advisory queue, and queries once per scrape', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('ai_daily_usage')) return [{ calls: 42 }];
      if (sql.includes('percentile_cont')) return [{ oldest: 12.5, p50: 4, p95: 61 }];
      if (sql.includes("interval '24 hours' GROUP BY")) {
        return [
          { status: 'COMPLETED', ai_source: 'FALLBACK', model: 'qwen3.5:0.8b-q8_0', error_code: null, review_status: 'ACCEPTED', total: 2 },
          { status: 'COMPLETED', ai_source: null, model: 'gemini-3.5-flash-lite', error_code: null, review_status: null, total: 5 },
          { status: 'FAILED', ai_source: null, model: 'gemini x', error_code: 'AI_PROVIDER_ERROR', review_status: null, total: 1 },
        ];
      }
      return [{ status: 'QUEUED', total: 3 }, { status: 'FAILED', total: 1 }];
    });
    const registry = new Registry();
    registerAiMetrics(registry, { query } as unknown as DataSource, { GEMINI_DAILY_CALL_LIMIT: '500' });
    const body = await registry.metrics();
    expect(body).toContain('c48_ai_daily_calls 42');
    expect(body).toContain('c48_ai_daily_call_limit 500');
    expect(body).toContain('c48_ai_advisory_requests{status="QUEUED"} 3');
    expect(body).toContain('c48_ai_advisory_requests{status="FAILED"} 1');
    expect(body).toContain('c48_ai_advisory_last_24h{status="COMPLETED",source="ollama",model="qwen3.5:0.8b-q8_0",error_code="none",review_status="ACCEPTED"} 2');
    expect(body).toContain('c48_ai_advisory_last_24h{status="COMPLETED",source="gemini_primary",model="gemini-3.5-flash-lite",error_code="none",review_status="PENDING"} 5');
    expect(body).toContain('c48_ai_advisory_last_24h{status="FAILED",source="none",model="other",error_code="AI_PROVIDER_ERROR",review_status="PENDING"} 1');
    expect(body).toContain('c48_ai_advisory_oldest_pending_age_seconds 12.5');
    expect(body).toContain('c48_ai_advisory_turnaround_seconds{quantile="0.95"} 61');
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('reports a zero limit when none is configured and survives a database error', async () => {
    const registry = new Registry();
    registerAiMetrics(registry, { query: async () => { throw new Error('down'); } } as unknown as DataSource, {});
    const body = await registry.metrics();
    expect(body).toContain('c48_ai_daily_call_limit 0');
    expect(body).not.toContain('c48_ai_advisory_requests{');
    expect(body).not.toContain('c48_ai_advisory_last_24h{');
  });
});
