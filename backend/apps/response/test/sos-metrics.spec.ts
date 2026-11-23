import { describe, expect, it, jest } from '@jest/globals';
import { Registry } from 'prom-client';
import { registerSosMetrics } from '../src/metrics/sos-metrics';

describe('SOS metrics', () => {
  it('exposes counts by status and the oldest waiting age, and caches the query', async () => {
    const query = jest.fn(async () => [
      { status: 'SUBMITTED', total: 3, oldest_seconds: 125.5 },
      { status: 'RESOLVED', total: 40, oldest_seconds: 99999 },
    ]);
    let clock = 1_000_000;
    const registry = new Registry();
    registerSosMetrics(registry, { query } as never, () => clock);

    const first = await registry.metrics();
    expect(first).toContain('c48_sos_requests{status="SUBMITTED"} 3');
    expect(first).toContain('c48_sos_requests{status="RESOLVED"} 40');
    expect(first).toContain('c48_sos_oldest_submitted_age_seconds 125.5');
    expect(first).not.toContain('99999');
    await registry.metrics();
    expect(query).toHaveBeenCalledTimes(1);
    clock += 16_000;
    await registry.metrics();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('stays empty instead of failing the scrape when the database is unavailable', async () => {
    const registry = new Registry();
    registerSosMetrics(registry, { query: jest.fn(async () => { throw new Error('connection refused'); }) } as never);
    const body = await registry.metrics();
    expect(body).toContain('c48_sos_oldest_submitted_age_seconds 0');
    expect(body).not.toContain('c48_sos_requests{');
  });
});
