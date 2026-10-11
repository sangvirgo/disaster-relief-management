export type BackendService = 'identity' | 'response' | 'logistics';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface RuntimeConfig {
  service: BackendService;
  nodeEnv: RuntimeEnvironment;
  databaseUrl: string;
  port: number;
  dbPoolMax: number;
  dbLockTimeoutMs: number;
  dbStatementTimeoutMs: number;
  logLevel: LogLevel;
}

const defaults: Record<BackendService, { port: number; pool: number }> = {
  identity: { port: 3001, pool: 20 },
  response: { port: 3002, pool: 30 },
  logistics: { port: 3003, pool: 20 },
};
const logLevels = new Set<LogLevel>(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const runtimeEnvironments = new Set<RuntimeEnvironment>(['development', 'test', 'production']);

function boundedInteger(raw: string | undefined, name: string, fallback: number, max: number, errors: string[]): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    errors.push(name);
    return fallback;
  }
  return parsed;
}

export function validateEnvironment(env: NodeJS.ProcessEnv | Record<string, string | undefined>, service: BackendService): RuntimeConfig {
  const errors: string[] = [];
  const databaseUrl = env.DATABASE_URL ?? '';
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) errors.push('DATABASE_URL');
  } catch {
    errors.push('DATABASE_URL');
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!runtimeEnvironments.has(nodeEnv as RuntimeEnvironment)) errors.push('NODE_ENV');
  const logLevel = env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info');
  if (!logLevels.has(logLevel as LogLevel)) errors.push('LOG_LEVEL');
  const defaultsForService = defaults[service];
  const port = boundedInteger(env.PORT, 'PORT', defaultsForService.port, 65_535, errors);
  const dbPoolMax = boundedInteger(env.DB_POOL_MAX, 'DB_POOL_MAX', defaultsForService.pool, 100, errors);
  const dbLockTimeoutMs = boundedInteger(env.DB_LOCK_TIMEOUT_MS, 'DB_LOCK_TIMEOUT_MS', 3_000, 30_000, errors);
  const dbStatementTimeoutMs = boundedInteger(env.DB_STATEMENT_TIMEOUT_MS, 'DB_STATEMENT_TIMEOUT_MS', 8_000, 60_000, errors);
  if (errors.length) throw new Error(`Invalid backend configuration: ${[...new Set(errors)].join(', ')}`);
  return { service, nodeEnv: nodeEnv as RuntimeEnvironment, databaseUrl, port, dbPoolMax, dbLockTimeoutMs, dbStatementTimeoutMs, logLevel: logLevel as LogLevel };
}
