import { jest } from '@jest/globals';
import { RequestResolutionFinalizer } from '../src/resolution/request-resolution-finalizer.service';

const requestId = '40000000-0000-4000-8000-000000000001';
const intentId = '50000000-0000-4000-8000-000000000001';
const duplicateId = '30000000-0000-4000-8000-000000000001';
const missionId = '51000000-0000-4000-8000-000000000001';
const teamId = '52000000-0000-4000-8000-000000000001';

describe('RequestResolutionFinalizer', () => {
  it('calls Logistics outside the transaction and uses the intent CAS as the transaction first query', async () => {
    const order: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        order.push(`tx:${sql.trim().split(/\s+/u).slice(0, 4).join(' ')}`);
        return [];
      }),
    };
    const dataSource = {
      query: jest.fn(async () => {
        order.push('load-intent');
        return [{
          id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', state: 'PENDING',
          actor_user_id: '60000000-0000-4000-8000-000000000001', expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Hoàn tất',
          request_status: 'RESOLVING', request_version: 9, logistics_admitted_at: new Date(),
          organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
          reporter_user_id: null, outcome_basis: 'RESCUE_COMPLETED',
        }];
      }),
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<unknown>) => {
        order.push('begin-transaction');
        return callback(manager);
      }),
    };
    const logistics = {
      seal: jest.fn(async () => { order.push('seal'); }),
      freeze: jest.fn(async () => undefined),
      unseal: jest.fn(async () => undefined),
    };
    const sessions = { requestCoordinatorGrants: jest.fn(async () => [{
      user_id: '60000000-0000-4000-8000-000000000001', role_code: 'COORDINATOR', scope_type: 'ORGANIZATION',
      organization_id: '70000000-0000-4000-8000-000000000001', region_code: null, campaign_id: null,
    }]) };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);

    await expect(finalizer.completePending(intentId)).resolves.toBe(false);

    expect(order.slice(0, 3)).toEqual(['load-intent', 'seal', 'begin-transaction']);
    expect(order[3]).toMatch(/^tx:UPDATE resolution_intent/u);
    expect(manager.query.mock.calls[0]?.[0]).toMatch(/WHERE id=\$1 AND state='PENDING'/u);
  });

  it('binds finalization SQL values with explicit PostgreSQL types', async () => {
    let completionUpdate: { sql: string; parameters: unknown[] } | undefined;
    let noticeInsert: { sql: string; parameters: unknown[] } | undefined;
    const manager = {
      query: jest.fn(async (sql: string, parameters: unknown[] = []) => {
        if (sql.includes("UPDATE resolution_intent SET state='COMPLETED'")) return [[{
          id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', actor_user_id: '60000000-0000-4000-8000-000000000001',
          expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Hoàn tất',
        }], 1];
        if (/SELECT id FROM assistance_request WHERE id=\$1\s+OR/u.test(sql)) return [{ id: requestId }];
        if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
          id: requestId, status: 'RESOLVING', version: 9, work_cycle: 2, reporter_user_id: null, canonical_request_id: null,
        }];
        if (sql.includes('UPDATE assistance_request')) {
          completionUpdate = { sql, parameters };
          return [[{ id: requestId, status: 'RESOLVED', version: 10, reporter_user_id: '60000000-0000-4000-8000-000000000002' }], 1];
        }
        if (sql.includes('INSERT INTO notice')) noticeInsert = { sql, parameters };
        return [];
      }),
    };
    const dataSource = {
      query: jest.fn(async () => [{
        id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', state: 'PENDING',
        actor_user_id: '60000000-0000-4000-8000-000000000001', expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Hoàn tất',
        request_status: 'RESOLVING', request_version: 9, logistics_admitted_at: new Date(),
        organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
        reporter_user_id: '60000000-0000-4000-8000-000000000002', outcome_basis: 'RESCUE_COMPLETED',
      }]),
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager)),
    };
    const logistics = { seal: jest.fn(), freeze: jest.fn(), unseal: jest.fn() };
    const sessions = { requestCoordinatorGrants: jest.fn(async () => [{
      user_id: '60000000-0000-4000-8000-000000000001', role_code: 'COORDINATOR', scope_type: 'ORGANIZATION',
      organization_id: '70000000-0000-4000-8000-000000000001', region_code: null, campaign_id: null,
    }]) };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);

    await expect(finalizer.completePending(intentId)).resolves.toBe(true);

    expect(completionUpdate?.sql).toMatch(/resolved_at=CASE WHEN \$5::boolean THEN/u);
    expect(completionUpdate?.sql).toMatch(/resolution_seal_id=CASE WHEN \$5::boolean/u);
    expect(completionUpdate?.parameters).toEqual([requestId, 'RESOLVED', intentId, 9, true]);
    expect(noticeInsert?.sql).toMatch(/'text_code',\$4::text/u);
    expect(noticeInsert?.parameters).toEqual(['60000000-0000-4000-8000-000000000002', requestId, 10, 'REQUEST_RESOLVED']);
  });

  it('retries a transient local lock failure without repeating the Logistics call', async () => {
    const manager = { query: jest.fn(async () => []) };
    const dataSource = {
      query: jest.fn(async () => [{
        id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', state: 'PENDING',
        actor_user_id: '60000000-0000-4000-8000-000000000001', expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Hoàn tất',
        request_status: 'RESOLVING', request_version: 9, logistics_admitted_at: new Date(),
        organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
        reporter_user_id: null, outcome_basis: 'RESCUE_COMPLETED',
      }]),
      transaction: jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('lock timeout'), { code: '55P03' }))
        .mockImplementationOnce(async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager)),
    };
    const logistics = {
      seal: jest.fn(), freeze: jest.fn(), unseal: jest.fn(),
    };
    const sessions = { requestCoordinatorGrants: jest.fn(async () => [{
      user_id: '60000000-0000-4000-8000-000000000001', role_code: 'COORDINATOR', scope_type: 'ORGANIZATION',
      organization_id: '70000000-0000-4000-8000-000000000001', region_code: null, campaign_id: null,
    }]) };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);

    await expect(finalizer.completePending(intentId)).resolves.toBe(false);

    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(logistics.seal).toHaveBeenCalledTimes(1);
    expect(manager.query.mock.calls[0]?.[0]).toMatch(/UPDATE resolution_intent SET state='COMPLETED'/u);
  });

  it('skips Logistics when the request was never admitted', async () => {
    const manager = { query: jest.fn(async () => []) };
    const dataSource = {
      query: jest.fn(async () => [{
        id: intentId, request_id: requestId, work_cycle: 1, kind: 'RESOLUTION', state: 'PENDING',
        actor_user_id: '60000000-0000-4000-8000-000000000001', expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Không cần hỗ trợ',
        request_status: 'RESOLVING', request_version: 9, logistics_admitted_at: null,
        organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
        reporter_user_id: null, outcome_basis: 'NO_ACTION_REQUIRED',
      }]),
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager)),
    };
    const logistics = { seal: jest.fn(), freeze: jest.fn(), unseal: jest.fn() };
    const sessions = { requestCoordinatorGrants: jest.fn(async () => [{
      user_id: '60000000-0000-4000-8000-000000000001', role_code: 'COORDINATOR', scope_type: 'ORGANIZATION',
      organization_id: '70000000-0000-4000-8000-000000000001', region_code: null, campaign_id: null,
    }]) };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);

    await expect(finalizer.completePending(intentId)).resolves.toBe(false);

    expect(logistics.seal).not.toHaveBeenCalled();
    expect(manager.query.mock.calls[0]?.[0]).toMatch(/^\s*UPDATE resolution_intent/u);
  });

  it('requires current Identity permission before a pending operation can seal', async () => {
    const manager = { query: jest.fn(async () => []) };
    const dataSource = {
      query: jest.fn(async () => [{
        id: intentId, request_id: requestId, work_cycle: 1, kind: 'RESOLUTION', state: 'PENDING',
        actor_user_id: '60000000-0000-4000-8000-000000000001', expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Hoàn tất',
        request_status: 'RESOLVING', request_version: 9, logistics_admitted_at: new Date(),
        organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
        reporter_user_id: null, outcome_basis: 'RESCUE_COMPLETED',
      }]),
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager)),
    };
    const logistics = { seal: jest.fn(), freeze: jest.fn(), unseal: jest.fn() };
    const sessions = { requestCoordinatorGrants: jest.fn(async () => []) };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);

    await expect(finalizer.completePending(intentId)).resolves.toBe(false);

    expect(logistics.seal).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('unseals the exact ABORTING intent before an abort CAS transaction', async () => {
    const order: string[] = [];
    const manager = { query: jest.fn(async (sql: string) => { order.push(`tx:${sql.trim().split(/\s+/u).slice(0, 3).join(' ')}`); return []; }) };
    const dataSource = {
      query: jest.fn(async () => [{
        id: intentId, request_id: requestId, work_cycle: 3, kind: 'CANCELLATION', state: 'ABORTING',
        actor_user_id: '60000000-0000-4000-8000-000000000001', expected_request_version: 9, previous_status: 'IN_PROGRESS', reason: 'Hủy yêu cầu',
        request_status: 'RESOLVING', request_version: 9, logistics_admitted_at: new Date(),
        organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
        reporter_user_id: null, outcome_basis: null,
      }]),
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<unknown>) => { order.push('begin-transaction'); return callback(manager); }),
    };
    const logistics = {
      seal: jest.fn(), freeze: jest.fn(),
      unseal: jest.fn(async (_requestId: string, _cycle: number, command: { intent_id: string }) => { order.push(`unseal:${command.intent_id}`); }),
    };
    const sessions = { requestCoordinatorGrants: jest.fn() };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);

    await expect(finalizer.abortIntent(intentId, 'Đã đổi quyết định')).resolves.toBe(false);

    expect(order.slice(0, 2)).toEqual([`unseal:${intentId}`, 'begin-transaction']);
    expect(manager.query.mock.calls[0]?.[0]).toMatch(/UPDATE resolution_intent SET state='ABORTED'.*WHERE id=\$1 AND state='ABORTING'/su);
  });

  it('uses the durable abort-request reason when recovery retries with a different argument', async () => {
    const eventCalls: unknown[][] = [];
    const manager = {
      query: jest.fn(async (sql: string, parameters: unknown[] = []) => {
        if (sql.includes("UPDATE resolution_intent SET state='ABORTED'")) return [[{
          id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', actor_user_id: '60000000-0000-4000-8000-000000000001',
          expected_request_version: 10, previous_status: 'IN_PROGRESS',
        }], 1];
        if (sql.includes('FROM assistance_request') && sql.includes('FOR UPDATE')) return [{
          id: requestId, status: 'RESOLVING', version: 10, work_cycle: 2, reporter_user_id: null,
        }];
        if (sql.includes('SELECT status FROM mission')) return [];
        if (sql.includes('UPDATE assistance_request SET status=$2')) return [[{
          id: requestId, status: 'IN_PROGRESS', version: 11, reporter_user_id: null,
        }], 1];
        if (sql.includes('INSERT INTO request_event')) eventCalls.push([sql, ...parameters]);
        return [];
      }),
    };
    const dataSource = {
      query: jest.fn(async () => [{
        id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', state: 'ABORTING',
        actor_user_id: '60000000-0000-4000-8000-000000000001', expected_request_version: 10, previous_status: 'IN_PROGRESS', reason: 'Hoàn tất',
        abort_reason: 'Lý do hủy đã ghi nhận', request_status: 'RESOLVING', request_version: 10, logistics_admitted_at: null,
        organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
        reporter_user_id: null, outcome_basis: null,
      }]),
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager)),
    };
    const logistics = { seal: jest.fn(), freeze: jest.fn(), unseal: jest.fn() };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, {} as never);

    await expect(finalizer.abortIntent(intentId, 'Lý do gửi lại khác')).resolves.toBe(true);

    expect(eventCalls[0]?.[5]).toBe('Lý do hủy đã ghi nhận');
  });

  it('locks canonical and duplicate requests by sorted id before team/mission cancellation', async () => {
    const order: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string, parameters: unknown[] = []) => {
        order.push(sql.trim().split(/\s+/u).slice(0, 5).join(' '));
        if (sql.includes("UPDATE resolution_intent SET state='COMPLETED'")) return [[{
          id: intentId, request_id: requestId, work_cycle: 2, kind: 'CANCELLATION', actor_user_id: '60000000-0000-4000-8000-000000000001',
          expected_request_version: 10, previous_status: 'IN_PROGRESS', reason: 'Hủy yêu cầu',
        }], 1];
        if (/SELECT id FROM assistance_request WHERE id=\$1\s+OR/u.test(sql)) return [{ id: duplicateId }, { id: requestId }];
        if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) {
          const id = parameters[0];
          return [id === requestId ? {
            id: requestId, status: 'RESOLVING', version: 10, work_cycle: 2, reporter_user_id: null, canonical_request_id: null,
          } : {
            id: duplicateId, status: 'DUPLICATE', version: 3, work_cycle: 1, reporter_user_id: null, canonical_request_id: requestId,
          }];
        }
        if (sql.includes('SELECT id FROM assistance_request WHERE canonical_request_id=$1')) return [{ id: duplicateId }];
        if (sql.includes('SELECT id,team_id,status,version FROM mission') && !sql.includes('FOR UPDATE')) return [{
          id: missionId, team_id: teamId, status: 'ACCEPTED', version: 4,
        }];
        if (sql.includes('SELECT id,team_id,status,version FROM mission') && sql.includes('FOR UPDATE')) return [{
          id: missionId, team_id: teamId, status: 'ACCEPTED', version: 4,
        }];
        if (sql.includes("UPDATE mission SET status='CANCELLED'")) return [[{ id: missionId, version: 5 }], 1];
        if (sql.includes('UPDATE assistance_request') && parameters[1] === 'CANCELLED') return [[{
          id: requestId, status: 'CANCELLED', version: 11, reporter_user_id: null,
        }], 1];
        if (sql.includes("UPDATE assistance_request SET status='VERIFYING'")) return [[{ id: duplicateId, version: 4 }], 1];
        return [];
      }),
    };
    const dataSource = {
      query: jest.fn(async () => [{
        id: intentId, request_id: requestId, work_cycle: 2, kind: 'CANCELLATION', state: 'PENDING',
        actor_user_id: '60000000-0000-4000-8000-000000000001', expected_request_version: 10, previous_status: 'IN_PROGRESS', reason: 'Hủy yêu cầu',
        request_status: 'RESOLVING', request_version: 10, logistics_admitted_at: null,
        organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
        reporter_user_id: null, outcome_basis: null,
      }]),
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager)),
    };
    const logistics = { seal: jest.fn(), freeze: jest.fn(), unseal: jest.fn() };
    const sessions = { requestCoordinatorGrants: jest.fn(async () => [{
      user_id: '60000000-0000-4000-8000-000000000001', role_code: 'COORDINATOR', scope_type: 'ORGANIZATION',
      organization_id: '70000000-0000-4000-8000-000000000001', region_code: null, campaign_id: null,
    }]) };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);

    await expect(finalizer.completePending(intentId)).resolves.toBe(true);

    expect(order[0]).toMatch(/^UPDATE resolution_intent/u);
    const childLockIndex = manager.query.mock.calls.findIndex(([sql, parameters]) => String(sql).includes('FROM assistance_request WHERE id=$1 FOR UPDATE') && parameters?.[0] === duplicateId);
    const canonicalLockIndex = manager.query.mock.calls.findIndex(([sql, parameters]) => String(sql).includes('FROM assistance_request WHERE id=$1 FOR UPDATE') && parameters?.[0] === requestId);
    const teamLockIndex = manager.query.mock.calls.findIndex(([sql]) => String(sql).includes('FROM rescue_team'));
    const missionLockIndex = manager.query.mock.calls.findIndex(([sql]) => String(sql).includes('FROM mission') && String(sql).includes('FOR UPDATE'));
    expect(childLockIndex).toBeLessThan(canonicalLockIndex);
    expect(canonicalLockIndex).toBeLessThan(teamLockIndex);
    expect(teamLockIndex).toBeLessThan(missionLockIndex);
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("readiness_required=true,version=version+1"))).toBe(true);
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("'DUPLICATE_ORPHANED'"))).toBe(true);
  });
});
