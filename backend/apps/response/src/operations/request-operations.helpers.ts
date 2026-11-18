import { AppError } from '@c48/technical/errors/errors';
import { Grant, Permission } from '@c48/identity-contracts/permissions';
import type { RequestCoordinatorGrant } from '../requests/reporter-session';
import { requestScopeFilter } from '../requests/request-scope';
import type { OperationRequestRow, RequestEventRow, RequestOperationsConfig } from './request-operations.types';

export const openDangerStatuses = "'SUBMITTED','VERIFYING','VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING'";

export const unverifiedStatuses = new Set(['SUBMITTED', 'VERIFYING']);

export const blockedCanonicalStatuses = new Set(['DUPLICATE', 'REJECTED', 'CANCELLED']);

export const terminalStatuses = new Set(['REJECTED', 'DUPLICATE', 'RESOLVED', 'CLOSED', 'CANCELLED']);

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function loadOperationsConfig(env: Record<string, string | undefined> = process.env): RequestOperationsConfig {
  const overdueMinutes = Number(env.VERIFY_OVERDUE_MINUTES ?? 15);
  if (!Number.isSafeInteger(overdueMinutes) || overdueMinutes < 1 || overdueMinutes > 1_440) {
    throw new Error('Invalid Response configuration: VERIFY_OVERDUE_MINUTES');
  }
  return { overdueMinutes };
}

export function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export function cleanText(value: string | undefined, required = false): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if ((required && !normalized) || normalized !== value.normalize('NFC')) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  return normalized || null;
}

export function checkVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: actual } });
}

export function scopeSql(
  grants: readonly Grant[], permission: Permission, values: unknown[], alias = 'r',
): string {
  return requestScopeFilter(grants, permission, values, alias);
}

export function grantCovers(grant: RequestCoordinatorGrant, row: Pick<OperationRequestRow, 'campaign_id'>): boolean {
  if (grant.scope_type === 'SYSTEM') return true;
  return grant.scope_type === 'CAMPAIGN' && Boolean(row.campaign_id) && grant.campaign_id === row.campaign_id;
}

export function parseBbox(value: string | undefined): [number, number, number, number] | undefined {
  if (!value) return undefined;
  const values = value.split(',').map(Number);
  if (values.length !== 4 || values.some((item) => !Number.isFinite(item))) throw new AppError('VALIDATION_FAILED', { status: 400 });
  const [west, south, east, north] = values as [number, number, number, number];
  if (west < -180 || west > 180 || east < -180 || east > 180 || south < -90 || south > 90 ||
      north < -90 || north > 90 || west >= east || south >= north || east - west > 0.5 || north - south > 0.5) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  return [west, south, east, north];
}

export function filtersHash(grants: readonly Grant[], userId: string, query: object, route: string): unknown {
  const queryFilters = { ...(query as Record<string, unknown>) };
  delete queryFilters.cursor;
  const scopes = grants.map(({ role_code, scope_type, campaign_id }) => ({
    role_code, scope_type, campaign_id: campaign_id ?? null,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { route, user_id: userId, grants: scopes, query: queryFilters };
}

export function relatedRequestIds(payload: Record<string, unknown>): string[] {
  const ids = [...(Array.isArray(payload.recent_request_ids) ? payload.recent_request_ids : []), ...(Array.isArray(payload.rejected_request_ids) ? payload.rejected_request_ids : [])];
  if (typeof payload.canonical_request_id === 'string') ids.push(payload.canonical_request_id);
  const refs = asObject(payload.source_refs);
  if (Array.isArray(refs.request_ids)) ids.push(...refs.request_ids);
  return ids.filter((id): id is string => typeof id === 'string' && uuidPattern.test(id));
}

export function restrictEventPayload(event: RequestEventRow, allowedRequestIds: Set<string>): Record<string, unknown> {
  const payload = { ...asObject(event.payload) };
  for (const field of ['recent_request_ids', 'rejected_request_ids']) {
    if (Array.isArray(payload[field])) payload[field] = (payload[field] as unknown[]).filter((id) => typeof id === 'string' && allowedRequestIds.has(id));
  }
  if (typeof payload.canonical_request_id === 'string' && !allowedRequestIds.has(payload.canonical_request_id)) delete payload.canonical_request_id;
  if (payload.source_refs && typeof payload.source_refs === 'object') {
    const refs = { ...asObject(payload.source_refs) };
    if (Array.isArray(refs.request_ids)) refs.request_ids = refs.request_ids.filter((id) => typeof id === 'string' && allowedRequestIds.has(id));
    payload.source_refs = refs;
  }
  return payload;
}
