import { describe, expect, it, jest } from '@jest/globals';
import { Registry } from 'prom-client';
import { recordEmailDelivery, registerEmailMetrics } from '../src/auth/email-metrics';
import { loadIdentityAuthConfig } from '../src/auth/auth-security';

describe('Identity email metrics', () => {
  it('exposes outbox backlog, delivery outcomes and SMTP configuration without personal data', async () => {
    const registry = new Registry();
    const query = jest.fn(async (_sql: string) => [{ pending: 2, oldest_seconds: 95.5 }]);
    let configured = true;
    registerEmailMetrics(registry, { query } as never, () => configured);

    recordEmailDelivery('password_reset', 'failed');
    recordEmailDelivery('password_reset', 'dropped');
    recordEmailDelivery('registration', 'sent');

    const text = await registry.metrics();
    expect(text).toContain('c48_identity_email_outbox_pending 2');
    expect(text).toContain('c48_identity_email_outbox_oldest_age_seconds 95.5');
    expect(text).toContain('c48_identity_email_delivery_configured 1');
    expect(text).toContain('c48_identity_email_deliveries_total{kind="password_reset",outcome="dropped"} 1');
    expect(text).toContain('c48_identity_email_deliveries_total{kind="registration",outcome="failed"} 0');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toMatch(/c\.consumed_at IS NULL AND c\.expires_at > clock_timestamp\(\)/u);
    expect(text).not.toMatch(/@|challenge_id|email="/u);

    configured = false;
    expect(await registry.metrics()).toContain('c48_identity_email_delivery_configured 0');
  });
});

describe('IDENTITY_SCHEDULER_ENABLED', () => {
  it('defaults to cleanup on, accepts only true or false', () => {
    expect(loadIdentityAuthConfig({ NODE_ENV: 'test' }).cleanupEnabled).toBe(true);
    expect(loadIdentityAuthConfig({ NODE_ENV: 'test', IDENTITY_SCHEDULER_ENABLED: 'false' }).cleanupEnabled).toBe(false);
    expect(loadIdentityAuthConfig({ NODE_ENV: 'test', IDENTITY_SCHEDULER_ENABLED: 'true' }).cleanupEnabled).toBe(true);
    expect(() => loadIdentityAuthConfig({ NODE_ENV: 'test', IDENTITY_SCHEDULER_ENABLED: 'yes' })).toThrow('IDENTITY_SCHEDULER_ENABLED');
  });
});
