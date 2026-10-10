import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AppError } from './errors';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class IdempotencyKeyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method: string; path?: string; originalUrl?: string; headers: Record<string, string | string[] | undefined>; idempotencyKey?: string }>();
    const path = (request.path ?? request.originalUrl ?? '').split('?', 1)[0] ?? '';
    const exempt = /(?:^|\/)auth\/(?:login|refresh|logout|csrf)$/.test(path) ||
      /(?:^|\/)notices\/[^/]+\/read$/.test(path) || path.includes('/internal/');
    if (!safeMethods.has(request.method.toUpperCase()) && !exempt) {
      const raw = request.headers['idempotency-key'];
      const key = Array.isArray(raw) ? raw[0] : raw;
      if (!key) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
      if (!uuidPattern.test(key)) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
      request.idempotencyKey = key;
    }
    return next.handle();
  }
}
