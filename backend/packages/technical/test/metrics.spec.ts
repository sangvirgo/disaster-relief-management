import { describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createServiceMetrics, registerPoolMetrics } from '../src/observability/metrics';

function app() {
  const metrics = createServiceMetrics('response');
  const server = express();
  server.use(metrics.middleware);
  server.get('/metrics', metrics.handler);
  server.get('/api/v1/response/requests/:id', (req, res) => res.status(req.params.id === 'missing' ? 404 : 200).json({ ok: true }));
  server.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  return { metrics, server };
}

describe('service metrics', () => {
  it('labels requests by route template, never by the concrete URL, and keeps no identifier in any label', async () => {
    const { server } = app();
    await request(server).get('/api/v1/response/requests/3f2c1b9e-0000-4000-8000-000000000001?phone=0901234567&token=secret-token').expect(200);
    await request(server).get('/api/v1/response/requests/missing').expect(404);
    await request(server).get('/no/such/path/0901234567').expect(404);
    const body = (await request(server).get('/metrics').expect(200)).text;
    expect(body).toContain('c48_http_requests_total{method="GET",route="/api/v1/response/requests/:id",status="200",service="response"} 1');
    expect(body).toContain('route="unmatched",status="404"');
    for (const leaked of ['3f2c1b9e', '0901234567', 'secret-token', 'phone=']) expect(body).not.toContain(leaked);
    expect(body).toMatch(/c48_http_request_duration_seconds_bucket\{le="0\.1"/u);
    expect(body).toContain('process_cpu_user_seconds_total');
  });

  it('does not count health checks or the metrics endpoint itself', async () => {
    const { server } = app();
    await request(server).get('/health/live').expect(200);
    await request(server).get('/metrics').expect(200);
    const body = (await request(server).get('/metrics').expect(200)).text;
    expect(body).not.toContain('route="/health/live"');
    expect(body).not.toContain('route="/metrics"');
  });

  it.each(['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip', 'cf-ray'])('answers 404 when the request came through a proxy (%s)', async (header) => {
    const { server } = app();
    await request(server).get('/metrics').set(header, '203.0.113.9').expect(404);
    await request(server).get('/metrics').expect(200);
  });

  it('exposes the database pool gauges', async () => {
    const { metrics, server } = app();
    registerPoolMetrics(metrics.registry, () => ({ totalCount: 7, idleCount: 3, waitingCount: 1 }));
    const body = (await request(server).get('/metrics').expect(200)).text;
    expect(body).toContain('c48_db_pool_connections{service="response"} 7');
    expect(body).toContain('c48_db_pool_idle_connections{service="response"} 3');
    expect(body).toContain('c48_db_pool_waiting_clients{service="response"} 1');
  });
});
