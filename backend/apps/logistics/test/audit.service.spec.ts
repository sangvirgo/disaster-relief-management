import 'reflect-metadata';
import type { Request } from 'express';
import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../packages/technical/src/pagination/keyset';
import { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { AuditListQueryDto } from '../src/audit/audit.dto';
import { AuditService } from '../src/audit/audit.service';

const admin = {
  userId: '00000000-0000-4000-8000-000000000001',
  grants: [{ role_code: 'ADMIN', scope_type: 'SYSTEM', organization_id: null }],
  identityHeaders: {},
};

describe('Logistics AuditService', () => {
  it('only reads audit rows for a system AUDIT_READ grant', async () => {
    const query = jest.fn(async () => []);
    const sessions = { require: jest.fn(async () => ({ ...admin, grants: [
      { role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: 'org-1' },
    ] })) } as unknown as LogisticsSessionService;
    const service = new AuditService({ query } as unknown as DataSource, sessions);

    await expect(service.list({ entity_type: 'distribution' } as AuditListQueryDto, {} as Request))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a filtered keyset page with a cursor bound to its filters', async () => {
    const rows = [
      { id: '22', actor_user_id: admin.userId, action: 'DISTRIBUTION_DISPATCHED', entity_type: 'distribution', entity_id: 'dist-1', before_state: null, after_state: { status: 'DISPATCHED' }, reason: null, correlation_id: 'corr-1', created_at: new Date('2026-10-14T09:00:00Z'), cursor_created_at: '2026-10-14T09:00:00.000000Z' },
      { id: '21', actor_user_id: admin.userId, action: 'DISTRIBUTION_APPROVED', entity_type: 'distribution', entity_id: 'dist-1', before_state: { status: 'DRAFT' }, after_state: { status: 'APPROVED' }, reason: null, correlation_id: 'corr-2', created_at: new Date('2026-10-14T08:00:00Z'), cursor_created_at: '2026-10-14T08:00:00.000000Z' },
    ];
    const query = jest.fn(async () => rows);
    const sessions = { require: jest.fn(async () => admin) } as unknown as LogisticsSessionService;
    const service = new AuditService({ query } as unknown as DataSource, sessions);

    const first = await service.list({ entity_type: 'distribution', entity_id: 'dist-1', limit: 1 } as AuditListQueryDto, {} as Request);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ action: 'DISTRIBUTION_DISPATCHED', created_at: '2026-10-14T09:00:00.000Z' });
    expect(first.items[0]).not.toHaveProperty('cursor_created_at');
    expect(first.next_cursor).toEqual(expect.any(String));
    expect(query.mock.calls[0]?.[0]).toContain('entity_type = $1 AND entity_id = $2');

    query.mockResolvedValueOnce([rows[1]]);
    const second = await service.list({
      entity_type: 'distribution', entity_id: 'dist-1', limit: 1, cursor: first.next_cursor as string,
    } as AuditListQueryDto, {} as Request);
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    expect(query.mock.calls[1]?.[0]).toContain('(created_at, id) < ($3::timestamptz, $4::bigint)');
  });

  it('preserves PostgreSQL microseconds in the next-page cursor', async () => {
    const rows = [
      { id: '22', actor_user_id: admin.userId, action: 'DISTRIBUTION_DISPATCHED', entity_type: 'distribution', entity_id: 'dist-1', before_state: null, after_state: null, reason: null, correlation_id: null, created_at: new Date('2026-10-14T09:00:00.123456Z'), cursor_created_at: '2026-10-14T09:00:00.123456Z' },
      { id: '21', actor_user_id: admin.userId, action: 'DISTRIBUTION_APPROVED', entity_type: 'distribution', entity_id: 'dist-1', before_state: null, after_state: null, reason: null, correlation_id: null, created_at: new Date('2026-10-14T09:00:00.123455Z'), cursor_created_at: '2026-10-14T09:00:00.123455Z' },
    ];
    const query = jest.fn(async () => rows);
    const sessions = { require: jest.fn(async () => admin) } as unknown as LogisticsSessionService;
    const service = new AuditService({ query } as unknown as DataSource, sessions);

    const page = await service.list({ entity_type: 'distribution', limit: 1 } as AuditListQueryDto, {} as Request);

    expect(decodeKeysetCursor(page.next_cursor as string, { entity_type: 'distribution', entity_id: null }).sort)
      .toEqual(['2026-10-14T09:00:00.123456Z']);
  });

  it('rejects a cursor issued for different audit filters', async () => {
    const query = jest.fn(async () => []);
    const sessions = { require: jest.fn(async () => admin) } as unknown as LogisticsSessionService;
    const service = new AuditService({ query } as unknown as DataSource, sessions);
    const cursor = encodeKeysetCursor(['2026-10-14T09:00:00.000Z'], '22', { entity_type: 'warehouse', entity_id: null });

    await expect(service.list({ entity_type: 'distribution', cursor } as AuditListQueryDto, {} as Request))
      .rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid date', 'not-a-timestamp', '1'],
    ['impossible date', '2026-02-30T09:00:00.000000Z', '1'],
    ['noncanonical precision', '2026-10-14T09:00:00.123Z', '1'],
    ['invalid bigint', '2026-10-14T09:00:00.000000Z', 'not-a-bigint'],
    ['out-of-range bigint', '2026-10-14T09:00:00.000000Z', '9223372036854775808'],
  ])('rejects malformed cursor position (%s) before querying PostgreSQL', async (_label, timestamp, id) => {
    const query = jest.fn(async () => []);
    const sessions = { require: jest.fn(async () => admin) } as unknown as LogisticsSessionService;
    const service = new AuditService({ query } as unknown as DataSource, sessions);
    const cursor = encodeKeysetCursor([timestamp], id, { entity_type: 'distribution', entity_id: null });

    await expect(service.list({ entity_type: 'distribution', cursor } as AuditListQueryDto, {} as Request))
      .rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });
});
