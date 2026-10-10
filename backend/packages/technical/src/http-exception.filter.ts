import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { ErrorCatalog } from './error-catalog';
import { AppError, ErrorEnvelope } from './errors';
import { getCorrelationId } from './correlation';
import { BackendService } from './environment';
import { mapPostgresError } from './postgres-errors';

function httpCode(status: number, service: BackendService): string {
  switch (status) {
    case 400: return 'VALIDATION_FAILED';
    case 401: return 'UNAUTHENTICATED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'STATE_TRANSITION_INVALID';
    case 411: return 'LENGTH_REQUIRED';
    case 413: return 'PAYLOAD_TOO_LARGE';
    case 415: return 'UNSUPPORTED_MEDIA';
    case 429: return 'RATE_LIMITED';
    case 503: return service === 'identity' ? 'IDENTITY_UNAVAILABLE' : service === 'response' ? 'RESPONSE_UNAVAILABLE' : 'LOGISTICS_UNAVAILABLE';
    default: return 'INTERNAL_ERROR';
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly catalog: ErrorCatalog, private readonly service: BackendService = 'identity') {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<{ status(code: number): { json(body: ErrorEnvelope): unknown }; setHeader?(name: string, value: string): void }>();
    const correlationId = getCorrelationId() ?? randomUUID();
    const databaseError = mapPostgresError(exception);
    const appError = exception instanceof AppError ? exception : databaseError;
    const status = exception instanceof HttpException ? exception.getStatus() : undefined;
    const code = appError?.code ?? (status === undefined ? 'INTERNAL_ERROR' : httpCode(status, this.service));
    const match = this.catalog.get(code);
    const entry = match ?? this.catalog.get('INTERNAL_ERROR');
    const safeCode = match ? code : 'INTERNAL_ERROR';
    const safeEntry = entry ?? { status: 500, message: 'Hệ thống gặp lỗi. Vui lòng thử lại sau.' };
    const envelope: ErrorEnvelope = {
      code: safeCode,
      message: safeEntry.message,
      correlation_id: correlationId,
      ...(appError?.fieldErrors ? { field_errors: appError.fieldErrors } : {}),
      ...(appError?.details ? { details: appError.details } : {}),
    };
    if (appError?.retryAfterSeconds) response.setHeader?.('Retry-After', String(appError.retryAfterSeconds));
    response.status(safeEntry.status).json(envelope);
  }
}
