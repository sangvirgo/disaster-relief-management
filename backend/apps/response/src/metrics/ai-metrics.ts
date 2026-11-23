import { Gauge, type Registry } from 'prom-client';
import type { DataSource } from 'typeorm';

const CACHE_MS = 30_000;

/**
 * Gemini usage for the dashboard: calls made today against the configured daily limit (the quota day follows
 * America/Los_Angeles, as the service does) and the advisory queue by status. Counts only; no key, prompt or request id.
 */
export function registerAiMetrics(registry: Registry, dataSource: DataSource, env: Record<string, string | undefined> = process.env, now: () => number = Date.now): void {
  type Snapshot = { at: number; calls: number; byStatus: Map<string, number> };
  let cache: Snapshot | undefined;
  let inFlight: Promise<Snapshot> | undefined;

  function load(): Promise<Snapshot> {
    if (cache && now() - cache.at < CACHE_MS) return Promise.resolve(cache);
    inFlight ??= query().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  async function query(): Promise<Snapshot> {
    const usage = await dataSource.query(
      "SELECT calls FROM ai_daily_usage WHERE usage_date = date(timezone('America/Los_Angeles', now()))",
    ) as Array<{ calls: number }>;
    const rows = await dataSource.query('SELECT status, count(*)::int AS total FROM ai_advisory GROUP BY status') as Array<{ status: string; total: number }>;
    cache = { at: now(), calls: Number(usage[0]?.calls ?? 0), byStatus: new Map(rows.map((row) => [row.status, Number(row.total)])) };
    return cache;
  }

  const limit = Number(env.GEMINI_DAILY_CALL_LIMIT ?? '0');
  new Gauge({
    name: 'c48_ai_daily_call_limit', help: 'Configured Gemini calls per quota day (0 means no application limit).', registers: [registry],
    collect() { this.set(Number.isSafeInteger(limit) && limit > 0 ? limit : 0); },
  });
  new Gauge({
    name: 'c48_ai_daily_calls', help: 'Gemini calls counted by the application today (quota day).', registers: [registry],
    async collect() { try { this.set((await load()).calls); } catch { /* the gauge keeps its last value */ } },
  });
  new Gauge({
    name: 'c48_ai_advisory_requests', help: 'AI advisory rows by status.', labelNames: ['status'] as const, registers: [registry],
    async collect() {
      this.reset();
      try { for (const [status, total] of (await load()).byStatus) this.set({ status }, total); } catch { /* the gauge stays empty */ }
    },
  });
}
