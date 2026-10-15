import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { jest } from '@jest/globals';
import { RequestAdmissionService } from '../src/operations/request-admission.service';
import type { ReporterSession } from '../src/requests/reporter-session';

const requestId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';

function setup(overrides: Partial<{
  status: string;
  workCycle: number;
  version: number;
  lockedAt: Date | null;
  admittedAt: Date | null;
  pendingSupplement: boolean;
  grants: ReporterSession['grants'];
}> = {}) {
  const row = {
    id: requestId,
    status: overrides.status ?? 'TRIAGED',
    work_cycle: overrides.workCycle ?? 2,
    version: overrides.version ?? 4,
    organization_id: organizationId,
    region_code: 'NORTH',
    campaign_id: null,
    attribution_locked_at: overrides.lockedAt ?? null,
    logistics_admitted_at: overrides.admittedAt ?? null,
  };
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('FROM assistance_request') && sql.includes('FOR UPDATE')) return [row];
      if (sql.includes("supplement.event_type='REPORTER_SUPPLEMENT'")) return overrides.pendingSupplement ? [{}] : [];
      if (sql.includes('UPDATE assistance_request')) {
        row.attribution_locked_at = new Date('2026-10-12T12:00:00.000Z');
        row.logistics_admitted_at = new Date('2026-10-12T12:00:00.000Z');
        row.version += 1;
        return [[row], 1];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as EntityManager;
  const dataSource = { transaction: jest.fn((operation: (manager: EntityManager) => Promise<unknown>) => operation(manager)) };
  const sessions = {
    require: jest.fn().mockResolvedValue({
      userId: actorId,
      grants: overrides.grants ?? [{
        role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId,
        region_code: null, campaign_id: null,
      }],
    }),
  };
  return { service: new RequestAdmissionService(dataSource as unknown as DataSource, sessions as never), calls, manager, sessions };
}

describe('RequestAdmissionService', () => {
  it('locks the request, validates live actor scope and stamps attribution once', async () => {
    const { service, calls } = setup();

    await expect(service.admit(requestId, 2, {} as Request)).resolves.toEqual({
      request_id: requestId,
      work_cycle: 2,
      status: 'TRIAGED',
      organization_id: organizationId,
      region_code: 'NORTH',
      campaign_id: null,
      version: 5,
    });

    expect(calls[0]?.sql).toContain('FOR UPDATE');
    expect(calls[2]?.sql).toContain('attribution_locked_at=COALESCE');
    expect(calls[2]?.sql).toContain('logistics_admitted_at=clock_timestamp()');
  });

  it('returns the same cycle without another version bump on retry', async () => {
    const stamp = new Date('2026-10-12T12:00:00.000Z');
    const { service, calls } = setup({ lockedAt: stamp, admittedAt: stamp, status: 'IN_PROGRESS', version: 8 });

    await expect(service.admit(requestId, 2, {} as Request)).resolves.toMatchObject({
      work_cycle: 2, status: 'IN_PROGRESS', version: 8,
      organization_id: organizationId, region_code: 'NORTH', campaign_id: null,
    });

    expect(calls).toHaveLength(2);
  });

  it('rejects an ineligible request before setting admission markers', async () => {
    const { service, manager } = setup({ status: 'RESOLVING' });

    await expect(service.admit(requestId, 2, {} as Request)).rejects.toMatchObject({
      code: 'REQUEST_NOT_VERIFIED', status: 409,
    });
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('rejects a live actor without request attribution scope', async () => {
    const { service, manager } = setup({ grants: [{
      role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: '44444444-4444-4444-8444-444444444444',
    }] });

    await expect(service.admit(requestId, 2, {} as Request)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('rejects admission while a reporter supplement is awaiting review', async () => {
    const { service, manager } = setup({ pendingSupplement: true });

    await expect(service.admit(requestId, 2, {} as Request)).rejects.toMatchObject({
      code: 'PENDING_SUPPLEMENT_REVIEW', status: 409,
    });
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE assistance_request'))).toBe(false);
  });
});
