import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';

const correlation = new AsyncLocalStorage<string>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getCorrelationId(): string | undefined {
  return correlation.getStore();
}

export class CorrelationIdMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.headers['x-correlation-id'];
    const candidate = Array.isArray(header) ? header[0] : header;
    const id = candidate && uuidPattern.test(candidate) ? candidate : randomUUID();
    response.setHeader('X-Correlation-Id', id);
    correlation.run(id, next);
  }
}

export function correlationMiddleware(): RequestHandler {
  const middleware = new CorrelationIdMiddleware();
  return (request, response, next) => middleware.use(request, response, next);
}
