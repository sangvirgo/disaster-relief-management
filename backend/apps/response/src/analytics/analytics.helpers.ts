import { isDateString, isUUID } from 'class-validator';
import { AppError } from '@c48/technical/errors/errors';
import type { Grant } from '@c48/identity-contracts/permissions';

const utcTimestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

export interface DateWindowFilters {
  from: string;
  to: string;
  campaign_id: string | null;
  region_code: string | null;
}

export function dateWindowFilters(
  query: Record<string, unknown>,
  maxDays: number,
): DateWindowFilters {
  const from = query.from;
  const to = query.to;
  if (!validUtcTimestamp(from) || !validUtcTimestamp(to)) throw invalidQuery();

  const fromTimestamp = timestampParts(from);
  const toTimestamp = timestampParts(to);
  const wholeSeconds = toTimestamp.seconds - fromTimestamp.seconds;
  const fractionOrder = compareFractions(toTimestamp.fraction, fromTimestamp.fraction);
  if (wholeSeconds < 0 || (wholeSeconds === 0 && fractionOrder <= 0) ||
      wholeSeconds > maxDays * 86_400 ||
      (wholeSeconds === maxDays * 86_400 && fractionOrder > 0)) {
    throw invalidQuery();
  }

  const regionCode = optionalText(query.region_code, 80);
  const campaignId = optionalUuid(query.campaign_id);
  if (!regionCode && !campaignId) throw invalidQuery();
  return { from, to, campaign_id: campaignId, region_code: regionCode };
}

export function optionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) throw invalidQuery();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw invalidQuery();
  return normalized;
}

export function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !isUUID(value, 'all')) throw invalidQuery();
  return value;
}

export function analyticsCacheKey(
  userId: string,
  grants: readonly Grant[],
  filters: Record<string, unknown>,
): string {
  const normalizedGrants = grants.map(({ role_code, scope_type, organization_id, region_code, campaign_id }) => ({
    role_code,
    scope_type,
    organization_id,
    region_code: region_code ?? null,
    campaign_id: campaign_id ?? null,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify([userId, normalizedGrants, filters]);
}

export class AnalyticsCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; value: T }>();

  constructor(private readonly maxEntries = 128) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, { expiresAt: Date.now() + ttlMs, value });
  }
}

function validUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string' && utcTimestampPattern.test(value) &&
    isDateString(value, { strict: true, strictSeparator: true });
}

function timestampParts(value: string): { seconds: number; fraction: string } {
  const match = utcTimestampPattern.exec(value);
  if (!match?.[1]) throw invalidQuery();
  return { seconds: Date.parse(`${match[1]}Z`) / 1_000, fraction: match[2] ?? '' };
}

function compareFractions(left: string, right: string): number {
  const width = Math.max(left.length, right.length);
  const normalizedLeft = left.padEnd(width, '0');
  const normalizedRight = right.padEnd(width, '0');
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function invalidQuery(): AppError {
  return new AppError('VALIDATION_FAILED', { status: 400 });
}
