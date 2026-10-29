import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor } from '@c48/technical/pagination/keyset';
import type { KeysetCursor } from '@c48/technical/pagination/keyset';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const utcTimestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/u;
const maxReportWindowMs = 366 * 24 * 60 * 60 * 1_000;

export function decodeReportIdCursor(cursor: string | undefined, filters: unknown): KeysetCursor | undefined {
  if (!cursor) return undefined;
  const decoded = decodeKeysetCursor(cursor, filters);
  if (decoded.sort.length !== 1 || typeof decoded.sort[0] !== 'string' || decoded.sort[0] !== decoded.id || !uuidPattern.test(decoded.id)) {
    throw new AppError('CURSOR_INVALID', { status: 400 });
  }
  return decoded;
}

export function decodeReportPairCursor(cursor: string | undefined, filters: unknown): KeysetCursor | undefined {
  if (!cursor) return undefined;
  const decoded = decodeKeysetCursor(cursor, filters);
  if (decoded.sort.length !== 2 || decoded.sort.some((value) => typeof value !== 'string' || !uuidPattern.test(value)) ||
      decoded.sort[1] !== decoded.id) {
    throw new AppError('CURSOR_INVALID', { status: 400 });
  }
  return decoded;
}

function validUtcTimestamp(value: string): boolean {
  const match = utcTimestampPattern.exec(value);
  if (!match) return false;
  const millis = `${match[1]}.${(match[2] ?? '').slice(0, 3).padEnd(3, '0')}Z`;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) && date.toISOString() === millis;
}

export function reportWindow(from: string, to: string): { from: string; to: string } {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!validUtcTimestamp(from) || !validUtcTimestamp(to) || !Number.isFinite(start) || !Number.isFinite(end) ||
      end <= start || end - start > maxReportWindowMs) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  return { from, to };
}
