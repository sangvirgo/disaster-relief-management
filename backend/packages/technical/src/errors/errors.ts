export interface ErrorEnvelope {
  code: string;
  message: string;
  field_errors?: Record<string, string[]>;
  details?: Record<string, unknown>;
  correlation_id: string;
}

export interface AppErrorOptions {
  status?: number;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(code: string, options: AppErrorOptions = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.fieldErrors !== undefined) this.fieldErrors = options.fieldErrors;
    if (options.details !== undefined) this.details = options.details;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
