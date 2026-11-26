import { Counter, Gauge, type Registry } from 'prom-client';
import type { DataSource } from 'typeorm';

const CACHE_MS = 15_000;

/** Which email it was. A fixed set, so the label stays bounded; never the address or the code. */
export type EmailKind = 'registration' | 'password_reset';
/** sent: accepted by SMTP; failed: one attempt failed (a reset email is retried); dropped: given up for good. */
export type EmailOutcome = 'sent' | 'failed' | 'dropped';

const kinds: readonly EmailKind[] = ['registration', 'password_reset'];
const outcomes: readonly EmailOutcome[] = ['sent', 'failed', 'dropped'];

let deliveries: Counter<'kind' | 'outcome'> | undefined;

export function recordEmailDelivery(kind: EmailKind, outcome: EmailOutcome): void {
  deliveries?.inc({ kind, outcome });
}

/**
 * Email health for the dashboard and alerts: deliveries by outcome, the password-reset emails still waiting in the
 * outbox (only those whose code can still be used) and the age of the oldest one, and whether SMTP is configured.
 * Only counts and an age are exposed: no address, code or account identifier.
 */
export function registerEmailMetrics(
  registry: Registry,
  dataSource: DataSource,
  deliveryConfigured: () => boolean,
  now: () => number = Date.now,
): void {
  deliveries = new Counter({
    name: 'c48_identity_email_deliveries_total',
    help: 'Identity emails by kind (registration, password_reset) and outcome (sent, failed, dropped).',
    labelNames: ['kind', 'outcome'] as const,
    registers: [registry],
  });
  // Start every series at 0 so increase() sees the first failure after a restart.
  for (const kind of kinds) for (const outcome of outcomes) deliveries.inc({ kind, outcome }, 0);

  type Snapshot = { at: number; pending: number; oldestSeconds: number };
  let cache: Snapshot | undefined;
  let inFlight: Promise<Snapshot> | undefined;

  function load(): Promise<Snapshot> {
    if (cache && now() - cache.at < CACHE_MS) return Promise.resolve(cache);
    inFlight ??= query().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  async function query(): Promise<Snapshot> {
    const rows = await dataSource.query(
      `SELECT count(*)::int AS pending,
              COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - min(o.created_at))), 0)::float8 AS oldest_seconds
         FROM identity_email_outbox o
         JOIN password_reset_challenge c ON c.challenge_id = o.challenge_id
        WHERE c.consumed_at IS NULL AND c.expires_at > clock_timestamp()`,
    ) as Array<{ pending: number; oldest_seconds: number }>;
    const row = rows[0];
    cache = { at: now(), pending: Number(row?.pending ?? 0), oldestSeconds: Number(row?.oldest_seconds ?? 0) };
    return cache;
  }

  new Gauge({
    name: 'c48_identity_email_outbox_pending',
    help: 'Password-reset emails waiting to be sent whose code is still valid.',
    registers: [registry],
    async collect() {
      try { this.set((await load()).pending); } catch { /* the gauge keeps its last value */ }
    },
  });
  new Gauge({
    name: 'c48_identity_email_outbox_oldest_age_seconds',
    help: 'Age of the oldest password-reset email still waiting to be sent (0 when none).',
    registers: [registry],
    async collect() {
      try { this.set((await load()).oldestSeconds); } catch { /* the gauge keeps its last value */ }
    },
  });
  new Gauge({
    name: 'c48_identity_email_delivery_configured',
    help: '1 when SMTP host, sender address and the OTP pepper are set, so Identity can send email; 0 otherwise.',
    registers: [registry],
    collect() {
      this.set(deliveryConfigured() ? 1 : 0);
    },
  });
}
