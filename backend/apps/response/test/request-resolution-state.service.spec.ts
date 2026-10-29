import { jest } from '@jest/globals';
import type { IdempotentCommand } from '@c48/technical/idempotency/idempotency';
import { RequestResolutionStateService } from '../src/resolution/request-resolution-state.service';

const requestId = '40000000-0000-4000-8000-000000000001';
const userId = '60000000-0000-4000-8000-000000000001';
const organizationId = '70000000-0000-4000-8000-000000000001';
const campaignId = '90000000-0000-4000-8000-000000000001';

describe('RequestResolutionStateService', () => {
  it('closes a resolved request with a versioned audit event', async () => {
    const statements: string[] = [];
    const manager = { query: jest.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
        id: requestId, status: 'RESOLVED', version: 12, work_cycle: 3, organization_id: organizationId,
        region_code: 'DEMO_A', campaign_id: null, reporter_user_id: userId,
      }];
      if (sql.includes('UPDATE assistance_request')) return [[{ id: requestId, status: 'CLOSED', version: 13, reporter_user_id: userId }], 1];
      return [];
    }) };
    const dataSource = { query: jest.fn(async () => [{
      id: requestId, status: 'RESOLVED', version: 12, work_cycle: 3, organization_id: organizationId,
      region_code: 'DEMO_A', campaign_id: null, reporter_user_id: userId,
    }]) };
    const idempotency = { execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
      const outcome = await command.execute(manager as never);
      return { status: outcome.status, value: outcome.value, replay: false };
    }) };
    const sessions = { require: jest.fn(async () => ({ userId, grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId }] })) };
    const service = new RequestResolutionStateService(dataSource as never, idempotency as never, sessions as never);

    await expect(service.close(requestId, { expected_version: 12 }, '80000000-0000-4000-8000-000000000001', { headers: {} } as never))
      .resolves.toMatchObject({ status: 200, value: { id: requestId, status: 'CLOSED', version: 13 } });
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('REQUEST_CLOSED'),
      expect.stringContaining("jsonb_build_object('text_code',$4::text,'request_id',$2::uuid)"),
    ]));
  });

  it('locks campaign before request and opens the next cycle with cleared attribution', async () => {
    const statements: string[] = [];
    const manager = { query: jest.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM campaign WHERE id=$1 FOR SHARE')) return [{ id: campaignId, status: 'PAUSED', organization_id: organizationId, region_code: 'DEMO_A' }];
      if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
        id: requestId, status: 'CLOSED', version: 20, work_cycle: 4, organization_id: organizationId,
        region_code: 'DEMO_A', campaign_id: campaignId, reporter_user_id: userId,
      }];
      if (sql.includes('UPDATE assistance_request')) return [[{
        id: requestId, status: 'TRIAGED', version: 21, work_cycle: 5, organization_id: organizationId,
        region_code: 'DEMO_A', campaign_id: null, reporter_user_id: userId,
      }], 1];
      if (sql.includes('SELECT r.version,r.work_cycle AS "workCycle"')) return [{
        version: 21, workCycle: 5, incidentCategoryCode: 'FLOOD', description: null,
        reporterDeclaredDanger: false, needsRescue: true, needsReliefSupplies: false,
        peopleAffected: 3, childrenCount: 0, elderlyCount: 0,
      }];
      return [];
    }) };
    const dataSource = {
      query: jest.fn(async () => [{
        id: requestId, status: 'CLOSED', version: 20, work_cycle: 4, organization_id: organizationId,
        region_code: 'DEMO_A', campaign_id: campaignId, reporter_user_id: userId,
      }]),
    };
    const idempotency = { execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
      const outcome = await command.execute(manager as never);
      return { status: outcome.status, value: outcome.value, replay: false };
    }) };
    const sessions = { require: jest.fn(async () => ({ userId, grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId }] })) };
    const service = new RequestResolutionStateService(dataSource as never, idempotency as never, sessions as never);

    await expect(service.reopen(requestId, { expected_version: 20, reason: 'Cần xử lý lại' }, '80000000-0000-4000-8000-000000000002', { headers: {} } as never))
      .resolves.toMatchObject({ value: { status: 'TRIAGED', version: 21, work_cycle: 5 } });
    expect(statements.findIndex((sql) => sql.includes('FROM campaign WHERE id=$1 FOR SHARE')))
      .toBeLessThan(statements.findIndex((sql) => sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')));
    expect(statements).toEqual(expect.arrayContaining([expect.stringContaining('attribution_locked_at=NULL,logistics_admitted_at=NULL,resolution_seal_id=NULL,resolved_at=NULL')]));
  });
});
