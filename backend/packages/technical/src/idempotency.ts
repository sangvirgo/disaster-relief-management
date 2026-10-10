import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from './errors';
import { withDatabaseRetry } from './postgres-errors';

export interface ResourceRef {
  type: string;
  id: string;
}

export interface IdempotentOutcome<T> {
  status: number;
  value: T;
  resource: ResourceRef | null;
}

export interface IdempotentCommand<T> {
  scopeKey: string;
  command: string;
  key: string;
  requestHash: string;
  execute(manager: EntityManager): Promise<IdempotentOutcome<T>>;
  replay(manager: EntityManager, resource: ResourceRef | null, status: number): Promise<T>;
}

export interface IdempotentResult<T> {
  status: number;
  value: T;
  replay: boolean;
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Request values must be finite');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
      const item = (value as Record<string, unknown>)[key];
      return item === undefined ? [] : [[key, canonical(item)]];
    }));
  }
  throw new TypeError('Request values must be JSON-compatible');
}

export function canonicalRequestHash(payload: unknown, capabilitySecretHash?: string): string {
  return createHash('sha256').update(JSON.stringify({ payload: canonical(payload), capability_secret_hash: capabilitySecretHash ?? null })).digest('hex');
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class IdempotencyService {
  async execute<T>(dataSource: DataSource, command: IdempotentCommand<T>): Promise<IdempotentResult<T>> {
    if (!uuidPattern.test(command.key)) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
    if (!command.scopeKey || !command.command || !/^[0-9a-f]{64}$/i.test(command.requestHash)) {
      throw new TypeError('Idempotency scope, command, and SHA-256 request hash are required');
    }

    return withDatabaseRetry(() => dataSource.transaction(async (manager) => {
      // This insert must be the command transaction's first SQL so duplicate requests wait on the key.
      const inserted = await manager.query(
        'INSERT INTO idempotency_record (scope_key, command, idempotency_key, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (scope_key, command, idempotency_key) DO NOTHING RETURNING 1',
        [command.scopeKey, command.command, command.key, command.requestHash],
      ) as unknown[];

      if (inserted.length > 0) {
        const outcome = await command.execute(manager);
        if (!Number.isInteger(outcome.status) || outcome.status < 100 || outcome.status > 599) {
          throw new TypeError('An idempotent command must return an HTTP status');
        }
        const resourceType = outcome.resource?.type ?? null;
        const resourceId = outcome.resource?.id ?? null;
        const updated = await manager.query(
          'UPDATE idempotency_record SET response_status = $4, resource_type = $5, resource_id = $6 WHERE scope_key = $1 AND command = $2 AND idempotency_key = $3',
          [command.scopeKey, command.command, command.key, outcome.status, resourceType, resourceId],
        ) as unknown[];
        if (updated[1] !== 1) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return { status: outcome.status, value: outcome.value, replay: false };
      }

      const rows = await manager.query(
        'SELECT request_hash, response_status, resource_type, resource_id FROM idempotency_record WHERE scope_key = $1 AND command = $2 AND idempotency_key = $3',
        [command.scopeKey, command.command, command.key],
      ) as Array<{ request_hash: string; response_status: number | null; resource_type: string | null; resource_id: string | null }>;
      const row = rows[0];
      if (!row) throw new AppError('INTERNAL_ERROR', { status: 500 });
      if (row.request_hash !== command.requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED', { status: 409 });
      if (row.response_status === null || (row.resource_type === null) !== (row.resource_id === null)) {
        throw new AppError('INTERNAL_ERROR', { status: 500 });
      }
      const resource = row.resource_type && row.resource_id ? { type: row.resource_type, id: row.resource_id } : null;
      return { status: row.response_status, value: await command.replay(manager, resource, row.response_status), replay: true };
    }));
  }
}
