import { createHash } from 'node:crypto';
import { AppError } from '../errors/errors';

function stableValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Filter values must be finite');
    return value;
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().flatMap((key) => (
      record[key] === undefined ? [] : [[key, stableValue(record[key])]]
    )));
  }
  throw new TypeError('Filter values must be JSON-compatible');
}

export function filterHash(filters: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(filters))).digest('hex');
}

export interface KeysetCursor {
  sort: unknown[];
  id: string;
  filter_hash: string;
}

export function encodeKeysetCursor(sort: readonly unknown[], id: string, filters: unknown): string {
  if (sort.length === 0 || !id || sort.some((value) => value === null || (typeof value !== 'string' && typeof value !== 'number'))) {
    throw new TypeError('A non-null sort tuple and id are required');
  }
  const normalizedSort = sort.map(stableValue);
  return Buffer.from(JSON.stringify({ sort: normalizedSort, id, filter_hash: filterHash(filters) })).toString('base64url');
}

export function decodeKeysetCursor(cursor: string, filters: unknown): KeysetCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') throw new Error('invalid');
    const value = decoded as Partial<KeysetCursor>;
    if (!Array.isArray(value.sort) || value.sort.length === 0 || value.sort.some((item) => item === null || (typeof item !== 'string' && typeof item !== 'number')) || typeof value.id !== 'string' || !value.id ||
        typeof value.filter_hash !== 'string' || value.filter_hash !== filterHash(filters)) throw new Error('invalid');
    return { sort: value.sort, id: value.id, filter_hash: value.filter_hash };
  } catch {
    throw new AppError('CURSOR_INVALID', { status: 400 });
  }
}
