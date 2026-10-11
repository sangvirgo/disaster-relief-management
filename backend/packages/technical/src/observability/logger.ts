import { LoggerService } from '@nestjs/common';
import pino, { Logger, DestinationStream } from 'pino';
import { BackendService, LogLevel } from '../config/environment';
import { getCorrelationId } from './correlation';

export const LOG_REDACT_PATHS = [
  'authorization', 'headers.authorization', 'req.headers.authorization',
  'cookie', 'headers.cookie', 'req.headers.cookie',
  'headers["x-tracking-code"]', 'headers["x-tracking-secret"]',
  'headers["x-donation-secret"]', 'headers["x-recovery-code"]',
  'headers["x-csrf-token"]',
  'req.headers["x-tracking-code"]',
  'req.headers["x-tracking-secret"]', 'req.headers["x-donation-secret"]', 'req.headers["x-recovery-code"]', 'req.headers["x-csrf-token"]',
  'phone', '*.phone', '*.*.phone', 'body.phone', 'req.body.phone',
  'location', '*.location', '*.*.location', 'body.location', 'req.body.location',
  'password', '*.password', '*.*.password', 'body.password', 'req.body.password',
  'old_password', 'new_password', 'temporary_password', 'current_password',
  '*.old_password', '*.new_password', '*.temporary_password', '*.current_password',
  '*.*.old_password', '*.*.new_password', '*.*.temporary_password', '*.*.current_password',
  'oldPassword', 'newPassword', 'temporaryPassword', 'currentPassword',
  'secret', '*.secret', '*.*.secret', 'secret_hash_pepper', 'secretHashPepper',
  'SECRET_HASH_PEPPER_SOS', 'SECRET_HASH_PEPPER_DONATION',
  'csrf_token', '*.csrf_token', '*.*.csrf_token', 'body.csrf_token', 'req.body.csrf_token',
  'tracking_secret_hash', '*.tracking_secret_hash', '*.*.tracking_secret_hash', 'req.body.tracking_secret_hash',
  'donation_secret_hash', '*.donation_secret_hash', '*.*.donation_secret_hash', 'recovery_code_hash', '*.recovery_code_hash', '*.*.recovery_code_hash',
  'capability_secret_hash', '*.capability_secret_hash', '*.*.capability_secret_hash', 'code_hash', '*.code_hash', '*.*.code_hash',
  'token', '*.token', '*.*.token', 'access_token', 'refresh_token', '*.access_token', '*.refresh_token',
] as const;

export function createPinoLogger(service: BackendService, level: LogLevel = 'info', destination?: DestinationStream): Logger {
  return pino({
    level,
    base: { service },
    redact: { paths: [...LOG_REDACT_PATHS], censor: '[REDACTED]' },
    mixin: () => {
      const correlationId = getCorrelationId();
      return correlationId ? { correlation_id: correlationId } : {};
    },
  }, destination);
}

export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...optional: unknown[]): void {
    this.write('info', message, optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.write('trace', message, optional);
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.write('fatal', message, optional);
  }

  private write(level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal', message: unknown, optional: unknown[]): void {
    const context = optional.find((value): value is string => typeof value === 'string');
    if (level === 'error') {
      const code = message && typeof message === 'object' && 'code' in message && typeof message.code === 'string'
        ? message.code
        : typeof message === 'string' && /^[A-Z][A-Z0-9_]+$/.test(message) ? message : undefined;
      this.logger.error({ ...(context ? { context } : {}), ...(code ? { code } : {}) }, 'Backend error');
      return;
    }
    if (typeof message === 'string') {
      const code = /^[A-Z][A-Z0-9_]+$/.test(message) ? message : undefined;
      this.logger[level]({ ...(context ? { context } : {}), ...(code ? { code } : {}) }, 'Backend event');
      return;
    }
    if (message && typeof message === 'object' && 'code' in message && typeof message.code === 'string') {
      this.logger[level]({ code: message.code, ...(context ? { context } : {}) }, message.code);
      return;
    }
    this.logger[level]({ ...(context ? { context } : {}) }, 'Backend event');
  }
}
