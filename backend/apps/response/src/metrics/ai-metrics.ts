import { Gauge, type Registry } from 'prom-client';
import type { DataSource } from 'typeorm';

const CACHE_MS = 30_000;

type RecentRow = { status: string; source: string; model: string; error_code: string; review_status: string; total: number };
type Timing = { oldest: number | null; p50: number | null; p95: number | null };

/** Label values come from the database; anything outside a short code alphabet becomes `other` (no free text). */
function label(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value : '';
  if (!text) return fallback;
  return /^[A-Za-z0-9._:-]{1,60}$/u.test(text) ? text : 'other';
}

function sourceLabel(status: string, aiSource: unknown): string {
  if (status !== 'COMPLETED') return 'none';
  if (aiSource === 'FALLBACK') return 'ollama';
  if (aiSource === 'GEMINI_BACKUP') return 'gemini_backup';
  return 'gemini_primary';
}

const RECENT_SQL = `SELECT status, extracted_json->>'ai_source' AS ai_source, model, error_code, review_status, count(*)::int AS total
  FROM ai_advisory WHERE created_at > now() - interval '24 hours' GROUP BY 1, 2, 3, 4, 5`;

// Seconds from queueing to a finished advisory over the last 24 hours, and the age of the oldest unfinished job.
const TIMING_SQL = `SELECT
    EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE status IN ('QUEUED','PROCESSING')))::float8 AS oldest,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM completed_at - created_at))
      FILTER (WHERE status = 'COMPLETED' AND completed_at > now() - interval '24 hours') AS p50,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM completed_at - created_at))
      FILTER (WHERE status = 'COMPLETED' AND completed_at > now() - interval '24 hours') AS p95
  FROM ai_advisory`;

/**
 * Gemini usage for the dashboard: calls made today against the configured daily limit (the quota day follows
 * America/Los_Angeles, as the service does) and the advisory queue by status. Counts only; no key, prompt or request id.
 */
export function registerAiMetrics(registry: Registry, dataSource: DataSource, env: Record<string, string | undefined> = process.env, now: () => number = Date.now): void {
  type Snapshot = { at: number; calls: number; byStatus: Map<string, number>; recent: RecentRow[]; timing: Timing };
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
    const recentRows = await dataSource.query(RECENT_SQL) as Array<Record<string, unknown>>;
    const timingRows = await dataSource.query(TIMING_SQL) as Array<Record<string, unknown>>;
    const num = (value: unknown) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));
    const recent = recentRows.map((row) => {
      const status = label(row.status, 'other');
      return {
        status,
        source: sourceLabel(status, row.ai_source),
        model: label(row.model, 'none'),
        error_code: label(row.error_code, 'none'),
        review_status: label(row.review_status, 'PENDING'),
        total: Number(row.total ?? 0),
      };
    });
    const timing = { oldest: num(timingRows[0]?.oldest), p50: num(timingRows[0]?.p50), p95: num(timingRows[0]?.p95) };
    cache = { at: now(), calls: Number(usage[0]?.calls ?? 0), byStatus: new Map(rows.map((row) => [row.status, Number(row.total)])), recent, timing };
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
  new Gauge({
    name: 'c48_ai_advisory_last_24h',
    help: 'AI advisories created in the last 24 hours by status, answering source, model, error code and coordinator review.',
    labelNames: ['status', 'source', 'model', 'error_code', 'review_status'] as const,
    registers: [registry],
    async collect() {
      this.reset();
      try {
        for (const { total, ...labels } of (await load()).recent) this.inc(labels, total);
      } catch { /* the gauge stays empty */ }
    },
  });
  new Gauge({
    name: 'c48_ai_advisory_oldest_pending_age_seconds', help: 'Age of the oldest queued or processing advisory (0 when none).', registers: [registry],
    async collect() { try { this.set((await load()).timing.oldest ?? 0); } catch { /* keeps its last value */ } },
  });
  new Gauge({
    name: 'c48_ai_advisory_turnaround_seconds', help: 'Queue-to-answer time of advisories completed in the last 24 hours.',
    labelNames: ['quantile'] as const, registers: [registry],
    async collect() {
      this.reset();
      try {
        const { p50, p95 } = (await load()).timing;
        if (p50 !== null) this.set({ quantile: '0.5' }, p50);
        if (p95 !== null) this.set({ quantile: '0.95' }, p95);
      } catch { /* the gauge stays empty */ }
    },
  });
}
