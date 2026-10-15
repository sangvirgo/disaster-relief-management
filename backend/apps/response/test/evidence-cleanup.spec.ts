import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { EvidenceService } from '../src/evidence/evidence.service';

describe('Response evidence cleanup', () => {
  it('retries failed object deletion and stops after cleanup succeeds', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    let cleanupComplete = false;
    const managerQuery = jest.fn(async (sql: string): Promise<unknown> => {
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
      if (sql.includes('WITH candidates AS')) return cleanupComplete ? [] : [{ id, object_key: `req/${id}` }];
      throw new Error('unexpected transaction query');
    });
    const manager = { query: managerQuery };
    type QueryManager = typeof manager;
    const dataSource = {
      transaction: jest.fn(async (work: (transactionManager: QueryManager) => Promise<unknown>) => work(manager)),
      query: jest.fn(async () => { cleanupComplete = true; return []; }),
    };
    const deleteObject = jest.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockResolvedValue(undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new EvidenceService(
      dataSource as never, {} as never, {} as never, {} as never, {} as never,
      { deleteObject } as never, {} as never,
    );

    try {
      expect(await service.reconcilePending()).toBe(1);
      expect(await service.reconcilePending()).toBe(1);
      expect(await service.reconcilePending()).toBe(0);
      expect(deleteObject).toHaveBeenCalledTimes(2);
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(managerQuery.mock.calls[1]?.[0]).toContain("state='FAILED' AND cleanup_completed_at IS NULL");
    } finally {
      warn.mockRestore();
      service.onModuleDestroy();
    }
  });
});
