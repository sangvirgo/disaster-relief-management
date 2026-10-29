import { jest } from '@jest/globals';
import type { IdempotentCommand } from '@c48/technical/idempotency/idempotency';
import { RequestFailureReviewService } from '../src/resolution/request-failure-review.service';

const requestId = '40000000-0000-4000-8000-000000000001';
const missionId = '50000000-0000-4000-8000-000000000001';
const replacementId = '50000000-0000-4000-8000-000000000002';
const userId = '60000000-0000-4000-8000-000000000001';
const organizationId = '70000000-0000-4000-8000-000000000001';

describe('RequestFailureReviewService', () => {
  it('records a current-cycle review and versions both mission and request', async () => {
    const statements: string[] = [];
    const manager = { query: jest.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
        id: requestId, status: 'IN_PROGRESS', version: 9, work_cycle: 3, organization_id: organizationId,
        region_code: 'DEMO_A', campaign_id: null,
      }];
      if (sql.includes('SELECT request_id FROM mission WHERE id=$1')) return [{ request_id: requestId }];
      if (sql.includes('FROM mission WHERE id=$1 FOR UPDATE')) return [{
        id: missionId, request_id: requestId, work_cycle: 3, status: 'FAILED', version: 4,
      }];
      if (sql.includes('SELECT id FROM mission WHERE id=$1')) return [{ id: replacementId }];
      if (sql.includes('UPDATE mission')) return [[{ id: missionId, version: 5 }], 1];
      if (sql.includes('UPDATE assistance_request')) return [[{ id: requestId, version: 10 }], 1];
      return [];
    }) };
    const dataSource = { query: jest.fn(async () => [{
      id: missionId, request_id: requestId, work_cycle: 3, status: 'FAILED', version: 4,
      request_status: 'IN_PROGRESS', request_version: 9, request_work_cycle: 3,
      organization_id: organizationId, region_code: 'DEMO_A', campaign_id: null,
    }]) };
    const idempotency = { execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
      const outcome = await command.execute(manager as never);
      return { status: outcome.status, value: outcome.value, replay: false };
    }) };
    const sessions = { require: jest.fn(async () => ({ userId, grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId }] })) };
    const service = new RequestFailureReviewService(dataSource as never, idempotency as never, sessions as never);

    await expect(service.review(missionId, {
      expected_version: 9, reason: 'Đội thay thế đã hoàn tất', disposition: 'REPLACED', replacement_mission_id: replacementId,
    }, '80000000-0000-4000-8000-000000000003', { headers: {} } as never)).resolves.toMatchObject({
      status: 200, value: { mission_id: missionId, mission_version: 5, request_version: 10 },
    });
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('UPDATE mission SET version=version+1'),
      expect.stringContaining('MISSION_FAILURE_REVIEW'),
      expect.stringContaining('UPDATE assistance_request SET version=version+1'),
    ]));
  });
});
