import { Gauge, type Registry } from 'prom-client';
import type { DataSource } from 'typeorm';

const CACHE_MS = 15_000;

/**
 * Domain gauges for the dashboard: SOS requests by status and the age of the oldest request that is still waiting
 * for a human to verify it. Only counts and an age are exposed: no identifier, phone number or address.
 */
export function registerSosMetrics(registry: Registry, dataSource: DataSource, now: () => number = Date.now): void {
  type Snapshot = { at: number; byStatus: Map<string, number>; oldestSeconds: number };
  let cache: Snapshot | undefined;
  let inFlight: Promise<Snapshot> | undefined;

  // Both gauges are collected together in one scrape: share one query (and the in-flight promise).
  function load(): Promise<Snapshot> {
    if (cache && now() - cache.at < CACHE_MS) return Promise.resolve(cache);
    inFlight ??= query().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  async function query(): Promise<Snapshot> {
    const rows = await dataSource.query(
      `SELECT status, count(*)::int AS total,
              COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - min(received_at))), 0)::float8 AS oldest_seconds
         FROM assistance_request GROUP BY status`,
    ) as Array<{ status: string; total: number; oldest_seconds: number }>;
    const byStatus = new Map(rows.map((row) => [row.status, Number(row.total)]));
    const waiting = rows.find((row) => row.status === 'SUBMITTED');
    const snapshot = { at: now(), byStatus, oldestSeconds: waiting ? Number(waiting.oldest_seconds) : 0 };
    cache = snapshot;
    return snapshot;
  }

  new Gauge({
    name: 'c48_sos_requests', help: 'SOS requests by status.', labelNames: ['status'] as const, registers: [registry],
    async collect() {
      this.reset();
      try { for (const [status, total] of (await load()).byStatus) this.set({ status }, total); } catch { /* the gauge stays empty */ }
    },
  });
  new Gauge({
    name: 'c48_sos_oldest_submitted_age_seconds', help: 'Age of the oldest SOS still waiting for verification (0 when none).', registers: [registry],
    async collect() {
      try { this.set((await load()).oldestSeconds); } catch { this.set(0); }
    },
  });
}
