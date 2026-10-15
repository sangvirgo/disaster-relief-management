import { jest } from '@jest/globals';
import { RequestResolutionFinalizer } from '../src/resolution/request-resolution-finalizer.service';
import { RequestResolutionRecoveryService } from '../src/resolution/request-resolution-recovery.service';

describe('RequestResolutionRecoveryService', () => {
  it('runs only the recovery worker when its specific setting is enabled', () => {
    const previousScheduler = process.env.SCHEDULER_ENABLED;
    const previousRecovery = process.env.RESOLUTION_RECOVERY_ENABLED;
    jest.useFakeTimers();
    process.env.SCHEDULER_ENABLED = 'false';
    process.env.RESOLUTION_RECOVERY_ENABLED = 'true';
    try {
      const service = new RequestResolutionRecoveryService({} as never, {} as never);

      service.onModuleInit();

      expect(jest.getTimerCount()).toBe(1);
      service.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      if (previousScheduler === undefined) delete process.env.SCHEDULER_ENABLED;
      else process.env.SCHEDULER_ENABLED = previousScheduler;
      if (previousRecovery === undefined) delete process.env.RESOLUTION_RECOVERY_ENABLED;
      else process.env.RESOLUTION_RECOVERY_ENABLED = previousRecovery;
    }
  });

  it('keeps recovery enabled with the global scheduler setting', () => {
    const previousScheduler = process.env.SCHEDULER_ENABLED;
    const previousRecovery = process.env.RESOLUTION_RECOVERY_ENABLED;
    jest.useFakeTimers();
    process.env.SCHEDULER_ENABLED = 'true';
    process.env.RESOLUTION_RECOVERY_ENABLED = 'false';
    try {
      const service = new RequestResolutionRecoveryService({} as never, {} as never);

      service.onModuleInit();

      expect(jest.getTimerCount()).toBe(1);
      service.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      if (previousScheduler === undefined) delete process.env.SCHEDULER_ENABLED;
      else process.env.SCHEDULER_ENABLED = previousScheduler;
      if (previousRecovery === undefined) delete process.env.RESOLUTION_RECOVERY_ENABLED;
      else process.env.RESOLUTION_RECOVERY_ENABLED = previousRecovery;
    }
  });

  it('skips the scan when another worker holds the advisory lock and releases its runner', async () => {
    const runner = {
      connect: jest.fn(async () => undefined),
      query: jest.fn(async () => [{ locked: false }]),
      release: jest.fn(async () => undefined),
    };
    const dataSource = { createQueryRunner: jest.fn(() => runner) };
    const finalizer = {
      completePending: jest.fn(async () => true),
      abortIntent: jest.fn(async () => true),
    };
    const service = new RequestResolutionRecoveryService(dataSource as never, finalizer as never);

    await service.runOnce();

    expect(runner.query).toHaveBeenCalledTimes(1);
    expect(runner.query.mock.calls[0]?.[0]).toContain('pg_try_advisory_lock');
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(finalizer.completePending).not.toHaveBeenCalled();
    expect(finalizer.abortIntent).not.toHaveBeenCalled();
  });

  it('re-drives pending seals and exact aborts outside any database transaction', async () => {
    const queries: string[] = [];
    const runner = {
      connect: jest.fn(async () => undefined),
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];
        if (sql.includes('FROM resolution_intent')) return [
          { id: '50000000-0000-4000-8000-000000000001', state: 'PENDING', abort_reason: 'x' },
          { id: '50000000-0000-4000-8000-000000000002', state: 'ABORTING', abort_reason: 'Đã hủy' },
        ];
        return [];
      }),
      release: jest.fn(async () => undefined),
    };
    const dataSource = { createQueryRunner: jest.fn(() => runner) };
    const finalizer = {
      completePending: jest.fn(async () => true),
      abortIntent: jest.fn(async () => true),
    };
    const service = new RequestResolutionRecoveryService(dataSource as never, finalizer as never);

    await service.runOnce();

    expect(finalizer.completePending).toHaveBeenCalledWith('50000000-0000-4000-8000-000000000001');
    expect(finalizer.abortIntent).toHaveBeenCalledWith('50000000-0000-4000-8000-000000000002', 'Đã hủy');
    expect(queries[0]).toContain('pg_try_advisory_lock');
    expect(queries.at(-1)).toContain('pg_advisory_unlock');
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('replays the same seal after a crash between Logistics seal and Response commit', async () => {
    const intentId = '50000000-0000-4000-8000-000000000001';
    const requestId = '40000000-0000-4000-8000-000000000001';
    const actorId = '60000000-0000-4000-8000-000000000001';
    const organizationId = '70000000-0000-4000-8000-000000000001';
    const intent = {
      id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', state: 'PENDING',
      actor_user_id: actorId, expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Hoàn tất',
      request_status: 'RESOLVING', request_version: 9, logistics_admitted_at: new Date(),
      organization_id: organizationId, region_code: 'DEMO_A', campaign_id: null,
      reporter_user_id: null, outcome_basis: 'RESCUE_COMPLETED',
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("UPDATE resolution_intent SET state='COMPLETED'")) return [[{
          id: intentId, request_id: requestId, work_cycle: 2, kind: 'RESOLUTION', actor_user_id: actorId,
          expected_request_version: 9, previous_status: 'TRIAGED', reason: 'Hoàn tất',
        }], 1];
        if (/SELECT id FROM assistance_request WHERE id=\$1\s+OR/u.test(sql)) return [{ id: requestId }];
        if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
          id: requestId, status: 'RESOLVING', version: 9, work_cycle: 2, reporter_user_id: null, canonical_request_id: null,
        }];
        if (sql.includes('UPDATE assistance_request')) return [[{
          id: requestId, status: 'RESOLVED', version: 10, reporter_user_id: null,
        }], 1];
        return [];
      }),
    };
    let transactionAttempts = 0;
    const dataSource = {
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn(async () => undefined),
        query: jest.fn(async (sql: string) => {
          if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];
          if (sql.includes('FROM resolution_intent')) return [{ id: intentId, state: 'PENDING', abort_reason: 'Hoàn tất' }];
          return [];
        }),
        release: jest.fn(async () => undefined),
      })),
      query: jest.fn(async () => [intent]),
      transaction: jest.fn(async (work: (manager: typeof manager) => Promise<unknown>) => {
        transactionAttempts += 1;
        const result = await work(manager);
        if (transactionAttempts === 1) throw Object.assign(new Error('connection lost before commit'), { code: '08006' });
        return result;
      }),
    };
    const logistics = { seal: jest.fn(async () => undefined), freeze: jest.fn(), unseal: jest.fn() };
    const sessions = { requestCoordinatorGrants: jest.fn(async () => [{
      user_id: actorId, role_code: 'COORDINATOR', scope_type: 'ORGANIZATION',
      organization_id: organizationId, region_code: null, campaign_id: null,
    }]) };
    const finalizer = new RequestResolutionFinalizer(dataSource as never, logistics as never, sessions as never);
    const recovery = new RequestResolutionRecoveryService(dataSource as never, finalizer);

    await recovery.runOnce();
    await recovery.runOnce();

    expect(transactionAttempts).toBe(2);
    expect(logistics.seal).toHaveBeenCalledTimes(2);
    expect(logistics.seal).toHaveBeenNthCalledWith(1, requestId, 2, { intent_id: intentId, outcome_basis: 'RESCUE_COMPLETED' });
    expect(logistics.seal).toHaveBeenNthCalledWith(2, requestId, 2, { intent_id: intentId, outcome_basis: 'RESCUE_COMPLETED' });
    expect(manager.query.mock.calls.filter(([sql]) => String(sql).includes("UPDATE resolution_intent SET state='COMPLETED'"))).toHaveLength(2);
  });
});
