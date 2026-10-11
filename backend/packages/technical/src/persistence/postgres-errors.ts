import { AppError } from '../errors/errors';

export interface ConstraintErrorMappings {
  unique?: Readonly<Record<string, string>>;
  check?: Readonly<Record<string, string>>;
}

interface PostgresErrorLike {
  code?: unknown;
  constraint?: unknown;
}

export function mapPostgresError(error: unknown, mappings: ConstraintErrorMappings = {}): AppError | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const postgresError = error as PostgresErrorLike;
  const code = typeof postgresError.code === 'string' ? postgresError.code : '';
  const constraint = typeof postgresError.constraint === 'string' ? postgresError.constraint : '';
  if (code === '23505') {
    return new AppError(mappings.unique?.[constraint] ?? 'STATE_TRANSITION_INVALID', { status: 409, cause: error });
  }
  if (code === '23514') {
    return new AppError(mappings.check?.[constraint] ?? 'STATE_TRANSITION_INVALID', { status: 409, cause: error });
  }
  if (code === '40P01' || code === '55P03' || code === '57014') {
    return new AppError('LOCK_TIMEOUT', { status: 503, retryAfterSeconds: 1, cause: error });
  }
  return undefined;
}

export interface DatabaseRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  mappings?: ConstraintErrorMappings;
}

export function jitteredInterval(milliseconds: number, random: () => number = Math.random, spread = 0.2): number {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isFinite(spread) || spread < 0 || spread > 1) {
    throw new RangeError('Invalid jitter interval');
  }
  return Math.round(milliseconds * (1 + ((random() * 2) - 1) * spread));
}

export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: DatabaseRetryOptions = {},
): Promise<T> {
  const retries = Math.min(2, Math.max(0, options.retries ?? 2));
  const baseDelayMs = options.baseDelayMs ?? 50;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const mapped = mapPostgresError(error, options.mappings);
      if (!mapped || mapped.code !== 'LOCK_TIMEOUT') throw mapped ?? error;
      if (attempt >= retries) throw mapped;
      await sleep(jitteredInterval(baseDelayMs * (attempt + 1), random));
    }
  }
}
