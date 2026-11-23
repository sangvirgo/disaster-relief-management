import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export type MetricsService = 'identity' | 'response' | 'logistics';

/** Headers a reverse proxy adds. A request carrying any of them did not come from Prometheus on the Docker network. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'forwarded'];

export interface ServiceMetrics {
  readonly registry: Registry;
  readonly middleware: RequestHandler;
  readonly handler: RequestHandler;
}

/**
 * Prometheus metrics for one API. Labels are limited to the HTTP method, the matched route TEMPLATE
 * (for example `/requests/:id`, never the concrete URL) and the status code, so no identifier, query string,
 * address or token can reach a label. `/metrics` answers only direct requests on the internal Docker network.
 */
export function createServiceMetrics(service: MetricsService): ServiceMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });

  const total = new Counter({
    name: 'c48_http_requests_total', help: 'HTTP requests by method, route template and status.',
    labelNames: ['method', 'route', 'status'] as const, registers: [registry],
  });
  const duration = new Histogram({
    name: 'c48_http_request_duration_seconds', help: 'HTTP request duration by method, route template and status.',
    labelNames: ['method', 'route', 'status'] as const, registers: [registry],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 90],
  });

  const middleware: RequestHandler = (request: Request, response: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    response.once('finish', () => {
      const routePath = typeof request.route?.path === 'string' ? `${request.baseUrl}${request.route.path}` : 'unmatched';
      if (routePath === '/metrics' || routePath.startsWith('/health')) return;
      const labels = { method: request.method, route: routePath, status: String(response.statusCode) };
      total.inc(labels);
      duration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
    });
    next();
  };

  const handler: RequestHandler = (request, response) => {
    if (PROXY_HEADERS.some((header) => request.headers[header] !== undefined)) {
      response.status(404).end();
      return;
    }
    registry.metrics().then(
      (body) => { response.setHeader('Content-Type', registry.contentType); response.setHeader('Cache-Control', 'no-store'); response.end(body); },
      () => { response.status(500).end(); },
    );
  };

  return { registry, middleware, handler };
}

interface PgPool { totalCount: number; idleCount: number; waitingCount: number }

/** Exposes the node-postgres pool of a TypeORM data source (connections in use, idle and queued). */
export function registerPoolMetrics(registry: Registry, pool: () => PgPool | undefined): void {
  const read = (field: keyof PgPool) => pool()?.[field] ?? 0;
  new Gauge({ name: 'c48_db_pool_connections', help: 'Application pool connections (total).', registers: [registry], collect() { this.set(read('totalCount')); } });
  new Gauge({ name: 'c48_db_pool_idle_connections', help: 'Application pool idle connections.', registers: [registry], collect() { this.set(read('idleCount')); } });
  new Gauge({ name: 'c48_db_pool_waiting_clients', help: 'Queries waiting for a pool connection.', registers: [registry], collect() { this.set(read('waitingCount')); } });
}

/** The node-postgres pool behind the application's TypeORM data source (undefined until it is initialised). */
function typeormPool(app: INestApplication): PgPool | undefined {
  try {
    const dataSource = app.get(DataSource, { strict: false });
    return (dataSource.driver as unknown as { master?: PgPool }).master;
  } catch {
    return undefined;
  }
}

/**
 * Attaches metrics to a Nest application before it starts listening. `domain` may register service-specific
 * gauges on the same registry. Call it right after the other `app.use(...)` middleware.
 */
export function installMetrics(
  app: INestApplication,
  service: MetricsService,
  options: { pool?: () => PgPool | undefined; domain?: (registry: Registry) => void } = {},
): ServiceMetrics {
  const metrics = createServiceMetrics(service);
  options = { pool: () => typeormPool(app), ...options };
  if (options.pool) registerPoolMetrics(metrics.registry, options.pool);
  options.domain?.(metrics.registry);
  const express = app.getHttpAdapter().getInstance() as { use: (handler: RequestHandler) => void; get: (path: string, handler: RequestHandler) => void };
  express.use(metrics.middleware);
  express.get('/metrics', metrics.handler);
  return metrics;
}
