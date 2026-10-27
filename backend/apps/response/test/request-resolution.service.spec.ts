import { jest } from '@jest/globals';
import type { IdempotentCommand } from '../../../packages/technical/src/idempotency/idempotency';
import { RequestResolutionService } from '../src/resolution/request-resolution.service';

const requestId = '40000000-0000-4000-8000-000000000001';
const intentId = '50000000-0000-4000-8000-000000000001';
const userId = '60000000-0000-4000-8000-000000000001';

describe('RequestResolutionService', () => {
  it.each([
    { name: 'accepts SQL completion evidence', missions: [{ status: 'COMPLETED', version: 3, has_outcome_evidence: true, failure_reviewed: false }], blockedReason: undefined },
    { name: 'accepts a reviewed failure with completed replacement', missions: [
      { status: 'FAILED', version: 2, has_outcome_evidence: false, failure_reviewed: true },
      { status: 'COMPLETED', version: 3, has_outcome_evidence: true, failure_reviewed: false },
    ], blockedReason: undefined },
    { name: 'blocks a completion without SQL evidence', missions: [{ status: 'COMPLETED', version: 3, has_outcome_evidence: false, failure_reviewed: false }], blockedReason: 'NO_COMPLETED_MISSION_EVIDENCE' },
    { name: 'blocks an unreviewed SQL failure', missions: [
      { status: 'FAILED', version: 2, has_outcome_evidence: false, failure_reviewed: false },
      { status: 'COMPLETED', version: 3, has_outcome_evidence: true, failure_reviewed: false },
    ], blockedReason: 'FAILED_MISSION_REVIEW_REQUIRED' },
  ])('$name before writing the resolution barrier', async ({ missions, blockedReason }) => {
    const statements: Array<{ sql: string; parameters: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, parameters: unknown[] = []) => {
        statements.push({ sql, parameters });
        if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
          id: requestId, status: 'TRIAGED', version: 8, work_cycle: 2, organization_id: '70000000-0000-4000-8000-000000000001',
          region_code: 'DEMO_A', campaign_id: null, reporter_user_id: userId, logistics_admitted_at: null,
        }];
        if (sql.includes('FROM request_event') && sql.includes('pending_review')) return [];
        if (sql.includes('FROM mission m')) return missions;
        if (sql.includes('INSERT INTO resolution_intent')) return [{ id: intentId }];
        if (sql.includes('UPDATE assistance_request')) return [[{ id: requestId, version: 9 }], 1];
        return [];
      }),
    };
    const dataSource = { query: jest.fn(async () => [{
      id: requestId, status: 'TRIAGED', version: 8, work_cycle: 2, organization_id: '70000000-0000-4000-8000-000000000001',
      region_code: 'DEMO_A', campaign_id: null, reporter_user_id: userId, logistics_admitted_at: null,
    }]) };
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
        const result = await command.execute(manager as never);
        return { status: result.status, value: result.value, replay: false };
      }),
    };
    const sessions = { require: jest.fn(async () => ({ userId, grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: '70000000-0000-4000-8000-000000000001' }] })) };
    const logistics = { fulfillment: jest.fn(async () => []) };
    const finalizer = { completePending: jest.fn(async () => true) };
    const service = new RequestResolutionService(dataSource as never, idempotency as never, sessions as never, logistics as never, finalizer as never);
    const request = { headers: {}, method: 'POST' } as never;

    const resolution = service.resolve(requestId, {
      expected_version: 8, resolution_reason: 'Đã hoàn tất', outcome_basis: 'RESCUE_COMPLETED',
    }, '80000000-0000-4000-8000-000000000001', request);

    if (blockedReason) {
      await expect(resolution).rejects.toMatchObject({ code: 'RESOLUTION_BLOCKED', details: { reasons: [blockedReason] } });
      expect(statements.some(({ sql }) => /^(INSERT|UPDATE)/u.test(sql))).toBe(false);
      expect(finalizer.completePending).not.toHaveBeenCalled();
      return;
    }
    const result = await resolution;
    expect(result).toMatchObject({ status: 202, replay: false, value: { operation_id: intentId, state: 'PENDING' } });
    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('INSERT INTO resolution_intent'),
      expect.stringContaining("SET status='RESOLVING',version=version+1"),
      expect.stringContaining('RESOLUTION_INTENT_CREATED'),
    ]));
    const event = statements.find(({ sql }) => sql.includes('RESOLUTION_INTENT_CREATED'));
    expect(JSON.parse(String(event?.parameters[4]))).toMatchObject({ intent_id: intentId, outcome_basis: 'RESCUE_COMPLETED' });
    expect(finalizer.completePending).toHaveBeenCalledWith(intentId);
  });

  it('replays the original 202 without requiring a live Logistics fulfillment read', async () => {
    const databaseReads: Array<{ sql: string; parameters: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, parameters: unknown[] = []): Promise<unknown[]> => {
        databaseReads.push({ sql, parameters });
        if (sql.includes('FROM idempotency_record')) return [{ present: true }];
        return [{
          id: requestId, status: 'RESOLVED', version: 10, work_cycle: 2,
          organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
          reporter_user_id: userId, logistics_admitted_at: new Date(),
        }];
      }),
    };
    const replayManager = {
      query: jest.fn(async () => [{
        id: intentId, kind: 'RESOLUTION', state: 'COMPLETED', request_id: requestId, work_cycle: 2, version: 2,
        request_status: 'RESOLVED', organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
      }]),
    };
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => ({
        status: 202,
        value: await command.replay(replayManager as never, { type: 'resolution_intent', id: intentId }, 202),
        replay: true,
      })),
    };
    const sessions = { require: jest.fn(async () => ({ userId, grants: [{
      role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: '70000000-0000-4000-8000-000000000001',
    }] })) };
    const logistics = { fulfillment: jest.fn(async () => { throw new Error('Logistics unavailable'); }) };
    const finalizer = { completePending: jest.fn() };
    const service = new RequestResolutionService(dataSource as never, idempotency as never, sessions as never, logistics as never, finalizer as never);

    const key = '80000000-0000-4000-8000-000000000001';
    await expect(service.resolve(requestId, {
      expected_version: 8, resolution_reason: 'Đã hoàn tất', outcome_basis: 'RESCUE_COMPLETED',
    }, key, { headers: {}, method: 'POST' } as never)).resolves.toMatchObject({
      status: 202,
      replay: true,
      value: { operation_id: intentId, state: 'PENDING' },
    });

    const keyLookup = databaseReads.find(({ sql }) => sql.includes('FROM idempotency_record'));
    expect(keyLookup).toMatchObject({
      sql: expect.stringContaining('scope_key=$1 AND command=$2 AND idempotency_key=$3'),
      parameters: [`response.request-resolve:${requestId}:${userId}`, 'response.requests.resolve', key],
    });
    expect(logistics.fulfillment).not.toHaveBeenCalled();
    expect(finalizer.completePending).not.toHaveBeenCalled();
  });
});
