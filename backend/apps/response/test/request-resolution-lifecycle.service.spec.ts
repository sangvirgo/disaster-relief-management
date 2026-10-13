import { jest } from '@jest/globals';
import type { IdempotentCommand } from '../../../packages/technical/src/idempotency/idempotency';
import { RequestResolutionFinalizer } from '../src/resolution/request-resolution-finalizer.service';
import { RequestResolutionLifecycleService } from '../src/resolution/request-resolution-lifecycle.service';

const requestId = '40000000-0000-4000-8000-000000000001';
const intentId = '50000000-0000-4000-8000-000000000001';
const userId = '60000000-0000-4000-8000-000000000001';
const organizationId = '70000000-0000-4000-8000-000000000001';

describe('RequestResolutionLifecycleService', () => {
  it('creates cancellation intent and barrier atomically before freezing Logistics', async () => {
    const statements: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
          id: requestId, status: 'IN_PROGRESS', version: 5, work_cycle: 2, organization_id: organizationId,
          region_code: 'DEMO_A', campaign_id: null, reporter_user_id: userId, logistics_admitted_at: null,
        }];
        if (sql.includes('INSERT INTO resolution_intent')) return [{ id: intentId }];
        if (sql.includes('UPDATE assistance_request')) return [[{ id: requestId, version: 6 }], 1];
        return [];
      }),
    };
    const dataSource = { query: jest.fn(async () => [{
      id: requestId, status: 'IN_PROGRESS', version: 5, work_cycle: 2, organization_id: organizationId,
      region_code: 'DEMO_A', campaign_id: null, reporter_user_id: userId, logistics_admitted_at: null,
    }]) };
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
        const result = await command.execute(manager as never);
        return { status: result.status, value: result.value, replay: false };
      }),
    };
    const sessions = { require: jest.fn(async () => ({ userId, grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId }] })) };
    const finalizer = { completePending: jest.fn(async () => true), abortIntent: jest.fn(async () => true) };
    const service = new RequestResolutionLifecycleService(dataSource as never, idempotency as never, sessions as never, finalizer as never);

    const result = await service.cancel(requestId, { expected_version: 5, reason: 'Không còn nhu cầu' },
      '80000000-0000-4000-8000-000000000001', { headers: {}, method: 'POST' } as never);

    expect(result).toMatchObject({ status: 202, value: { operation_id: intentId, state: 'PENDING' } });
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining("VALUES ($1,$2,'CANCELLATION',$3,$4+1,$5,$6)"),
      expect.stringContaining("SET status='RESOLVING',version=version+1"),
      expect.stringContaining('CANCELLATION_INTENT_CREATED'),
    ]));
    expect(finalizer.completePending).toHaveBeenCalledWith(intentId);
  });

  it('replays the original pending cancellation response after finalization', async () => {
    const dataSource = {
      query: jest.fn(async (): Promise<unknown[]> => [{
        id: requestId, status: 'CANCELLED', version: 7, work_cycle: 2, organization_id: organizationId,
        region_code: 'DEMO_A', campaign_id: null, reporter_user_id: userId, logistics_admitted_at: null,
      }]),
    };
    const replayManager = {
      query: jest.fn(async () => [{
        id: intentId, request_id: requestId, kind: 'CANCELLATION', state: 'COMPLETED', version: 2,
        work_cycle: 2, request_status: 'CANCELLED', request_version: 7, organization_id: organizationId,
        region_code: 'DEMO_A', campaign_id: null,
      }]),
    };
    let replayCommand: IdempotentCommand<Record<string, unknown>> | undefined;
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
        replayCommand = command;
        return {
          status: 202,
          value: await command.replay(replayManager as never, { type: 'resolution_intent', id: intentId }, 202),
          replay: true,
        };
      }),
    };
    const sessions = { require: jest.fn(async () => ({ userId, grants: [{
      role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId,
    }] })) };
    const finalizer = { completePending: jest.fn(), abortIntent: jest.fn() };
    const service = new RequestResolutionLifecycleService(dataSource as never, idempotency as never, sessions as never, finalizer as never);
    const key = '80000000-0000-4000-8000-000000000002';

    await expect(service.cancel(requestId, { expected_version: 5, reason: 'Không còn nhu cầu' }, key,
      { headers: {}, method: 'POST' } as never)).resolves.toMatchObject({
      status: 202, replay: true, value: { operation_id: intentId, state: 'PENDING' },
    });

    expect(replayCommand).toMatchObject({
      scopeKey: `response.request-cancel:${requestId}:${userId}`,
      command: 'response.requests.cancel',
      key,
    });
    expect(replayManager.query).not.toHaveBeenCalled();
    expect(finalizer.completePending).not.toHaveBeenCalled();
  });

  it('lets an abort win the compare-and-set race against an in-flight finalizer', async () => {
    let intentState = 'PENDING';
    let startSeal!: () => void;
    let finishSeal!: () => void;
    const sealStarted = new Promise<void>((resolve) => { startSeal = resolve; });
    const sealGate = new Promise<void>((resolve) => { finishSeal = resolve; });
    const intent = {
      id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', state: 'PENDING',
      actor_user_id: userId, expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Hoàn tất',
      request_status: 'RESOLVING', request_version: 9, logistics_admitted_at: new Date(),
      organization_id: organizationId, region_code: 'DEMO_A', campaign_id: null,
      reporter_user_id: null, outcome_basis: 'RESCUE_COMPLETED',
    };
    const operation = () => ({
      id: intentId, request_id: requestId, kind: 'RESOLUTION', state: intentState, version: 1, work_cycle: 2,
      request_status: 'RESOLVING', request_version: 9, organization_id: organizationId,
      region_code: 'DEMO_A', campaign_id: null,
    });
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT request_id FROM resolution_intent')) return [{ request_id: requestId }];
        if (sql.includes('SELECT id FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{ id: requestId }];
        if (sql.includes('FROM assistance_request r JOIN resolution_intent i')) return [operation()];
        if (sql.includes("UPDATE resolution_intent SET state='ABORTING'")) {
          if (intentState !== 'PENDING') return [[], 0];
          intentState = 'ABORTING';
          return [[{ id: intentId }], 1];
        }
        if (sql.includes("UPDATE resolution_intent SET state='COMPLETED'")) {
          if (intentState !== 'PENDING') return [[], 0];
          intentState = 'COMPLETED';
          return [[{ id: intentId }], 1];
        }
        return [];
      }),
    };
    const dataSource = {
      query: jest.fn(async (sql: string) => sql.includes('outcome_basis') ? [intent] : [operation()]),
      transaction: jest.fn(async (work: (tx: typeof manager) => Promise<unknown>) => work(manager)),
    };
    const sessions = {
      require: jest.fn(async () => ({ userId, grants: [{
        role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId,
      }] })),
      requestCoordinatorGrants: jest.fn(async () => [{
        user_id: userId, role_code: 'COORDINATOR', scope_type: 'ORGANIZATION',
        organization_id: organizationId, region_code: null, campaign_id: null,
      }]),
    };
    const logistics = { seal: jest.fn(async () => { startSeal(); await sealGate; }), freeze: jest.fn(), unseal: jest.fn() };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);
    const lifecycleFinalizer = { abortIntent: jest.fn(async () => true) };
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
        const result = await command.execute(manager as never);
        return { status: result.status, value: result.value, replay: false };
      }),
    };
    const lifecycle = new RequestResolutionLifecycleService(
      dataSource as never, idempotency as never, sessions as never, lifecycleFinalizer as never,
    );

    const finalization = finalizer.completePending(intentId);
    await sealStarted;
    const abort = await lifecycle.abortOperation(intentId, { expected_version: 9, reason: 'Cần hủy' },
      '80000000-0000-4000-8000-000000000003', { headers: {}, method: 'POST' } as never);
    finishSeal();
    const finalized = await finalization;

    expect(abort).toMatchObject({ status: 202, value: { operation_id: intentId, state: 'ABORTING' } });
    expect(finalized).toBe(false);
    expect(intentState).toBe('ABORTING');
    expect(manager.query.mock.calls.filter(([sql]) => String(sql).includes("UPDATE resolution_intent SET state='COMPLETED'"))).toHaveLength(1);
    expect(lifecycleFinalizer.abortIntent).toHaveBeenCalledWith(intentId, 'Cần hủy');
  });

  it('rejects abort after the finalizer has committed the winning transition', async () => {
    const completedOperation = {
      id: intentId, request_id: requestId, kind: 'RESOLUTION', state: 'COMPLETED', version: 2, work_cycle: 2,
      request_status: 'RESOLVED', request_version: 10, organization_id: organizationId,
      region_code: 'DEMO_A', campaign_id: null,
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT request_id FROM resolution_intent')) return [{ request_id: requestId }];
        if (sql.includes('SELECT id FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{ id: requestId }];
        if (sql.includes('FROM assistance_request r JOIN resolution_intent i')) return [completedOperation];
        return [];
      }),
    };
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
        const result = await command.execute(manager as never);
        return { status: result.status, value: result.value, replay: false };
      }),
    };
    const sessions = {
      require: jest.fn(async () => ({ userId, grants: [{
        role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId,
      }] })),
    };
    const finalizer = { abortIntent: jest.fn(async () => true) };
    const service = new RequestResolutionLifecycleService(
      { query: jest.fn(async () => [completedOperation]) } as never,
      idempotency as never,
      sessions as never,
      finalizer as never,
    );

    await expect(service.abortOperation(intentId, { expected_version: 10, reason: 'Đã hoàn tất' },
      '80000000-0000-4000-8000-000000000004', { headers: {}, method: 'POST' } as never))
      .rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID', status: 409 });

    expect(manager.query).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE resolution_intent SET state='ABORTING'"), expect.anything());
    expect(finalizer.abortIntent).not.toHaveBeenCalled();
  });
});
