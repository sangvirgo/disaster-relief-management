import type { DataSource } from 'typeorm';
import type { Request } from 'express';
import { jest } from '@jest/globals';
import { NeedsQueriesService } from '../src/needs/needs-queries.service';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';

const requestId = '11111111-1111-4111-8111-111111111111';
const cycleId = '22222222-2222-4222-8222-222222222222';
const needId = '33333333-3333-4333-8333-333333333333';
const organizationId = '44444444-4444-4444-8444-444444444444';

describe('NeedsQueriesService', () => {
  it('returns a scoped fulfillment board with derived totals and bounded contributions', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ id: cycleId, request_id: requestId, work_cycle: 2, organization_id: organizationId, region_code: 'HN', campaign_id: null, state: 'OPEN' }])
      .mockResolvedValueOnce([{
        id: needId, cycle_id: cycleId, request_id: requestId, work_cycle: 2, organization_id: organizationId,
        region_code: 'HN', campaign_id: null, item_id: '55555555-5555-4555-8555-555555555555', item_name: 'Nước sạch',
        unit_code: 'BOTTLE', unit_name: 'Chai', unit_scale: 0, original: '10.000', requested: '10.000',
        committed_reserved: '4.000', issued_unsettled: '2.000', delivered: '3.000', returned: '1.000', lost: '0.000',
        cancelled_remaining: null, status: 'PARTIALLY_FULFILLED', created_at: '2026-10-13T00:00:00.000Z',
        contributions: [{
          id: '66666666-6666-4666-8666-666666666666', warehouse_id: '77777777-7777-4777-8777-777777777777',
          warehouse_name: 'Kho Bắc', quantity: '10.000', released_quantity: '0.000', issued_quantity: '0.000',
          delivered_quantity: '0.000', returned_quantity: '0.000', lost_quantity: '0.000',
          created_by_user_id: '88888888-8888-4888-8888-888888888888', created_at: '2026-10-13T00:00:00.000Z',
        }],
        contributions_more: false,
      }]);
    const dataSource = { query } as unknown as DataSource;
    const sessions = {
      require: jest.fn(async () => ({
        userId: '88888888-8888-4888-8888-888888888888', identityHeaders: {},
        grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId, region_code: null, campaign_id: null }],
      })),
    } as unknown as LogisticsSessionService;
    const service = new NeedsQueriesService(dataSource, sessions);

    const result = await service.fulfillment(requestId, { work_cycle: 2 } as never, {} as Request);
    expect(result).toEqual({
      needs: [{
        id: needId,
        item: { id: '55555555-5555-4555-8555-555555555555', name: 'Nước sạch' },
        unit: { code: 'BOTTLE', display_name: 'Chai', scale: 0 },
        original: '10', requested: '10', committed_reserved: '4', issued_unsettled: '2', delivered: '3',
        returned: '1', lost: '0', outstanding: '7', cancelled_remaining: null, status: 'PARTIALLY_FULFILLED',
        contributions: {
          items: [{
            id: '66666666-6666-4666-8666-666666666666', warehouse_id: '77777777-7777-4777-8777-777777777777',
            warehouse_name: 'Kho Bắc', quantity: '10', reserved_remaining: '10', issued_unsettled: '0',
            delivered: '0', returned: '0', lost: '0', created_by_user_id: '88888888-8888-4888-8888-888888888888',
            created_at: '2026-10-13T00:00:00.000Z',
          }],
          more: false,
        },
      }],
      cycle_state: 'OPEN',
      generated_at: expect.any(String),
    });
    expect(sessions.require).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    const boardSql = query.mock.calls[1]?.[0];
    const boardSelect = String(boardSql).split('FROM relief_need n', 1)[0];
    expect(boardSelect).toContain('contribution.contributions,contribution.contributions_more');
  });

  it('does not query needs when the active actor has no matching scope', async () => {
    const query = jest.fn();
    const service = new NeedsQueriesService(
      { query } as unknown as DataSource,
      { require: jest.fn(async () => ({ userId: needId, grants: [], identityHeaders: {} })) } as unknown as LogisticsSessionService,
    );

    await expect(service.fulfillment(requestId, { work_cycle: 1 } as never, {} as Request)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('applies scope predicates before keyset pagination on the needs list', async () => {
    const query = jest.fn(async () => []);
    const service = new NeedsQueriesService(
      { query } as unknown as DataSource,
      { require: jest.fn(async () => ({
        userId: needId,
        identityHeaders: {},
        grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId, region_code: null, campaign_id: null }],
      })) } as unknown as LogisticsSessionService,
    );

    await expect(service.list({ request_id: requestId, work_cycle: 2, limit: 10 }, {} as Request)).resolves.toMatchObject({ items: [], more: false });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('c.organization_id=$1');
    expect(sql).toContain('c.request_id=$2');
    expect(sql).toContain('c.work_cycle=$3');
    expect(sql).toContain('ORDER BY n.created_at,n.id LIMIT $4');
    expect(values).toEqual([organizationId, requestId, 2, 11]);
  });

  it('preserves PostgreSQL microseconds in the needs-list cursor', async () => {
    const cursorTime = '2026-10-13T00:00:00.000123Z';
    const row = {
      id: needId, cycle_id: cycleId, request_id: requestId, work_cycle: 2, organization_id: organizationId,
      region_code: 'HN', campaign_id: null, item_id: '55555555-5555-4555-8555-555555555555', item_name: 'Nước sạch',
      unit_code: 'BOTTLE', unit_name: 'Chai', unit_scale: 0, original: '10.000', requested: '10.000',
      committed_reserved: '0.000', issued_unsettled: '0.000', delivered: '0.000', returned: '0.000', lost: '0.000',
      cancelled_remaining: null, status: 'OPEN', version: 1, created_at: cursorTime, cursor_created_at: cursorTime,
    };
    const query = jest.fn().mockResolvedValueOnce([row, { ...row, id: '99999999-9999-4999-8999-999999999999' }]).mockResolvedValueOnce([]);
    const service = new NeedsQueriesService(
      { query } as unknown as DataSource,
      { require: jest.fn(async () => ({
        userId: needId,
        identityHeaders: {},
        grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId, region_code: null, campaign_id: null }],
      })) } as unknown as LogisticsSessionService,
    );

    const firstPage = await service.list({ request_id: requestId, work_cycle: 2, limit: 1 }, {} as Request);
    await service.list({ request_id: requestId, work_cycle: 2, limit: 1, cursor: firstPage.cursor as string }, {} as Request);

    const values = query.mock.calls[1]?.[1] as unknown[];
    expect(values[3]).toBe(cursorTime);
    expect(String(query.mock.calls[1]?.[0])).toContain('(n.created_at,n.id)>($4::timestamptz,$5::uuid)');
  });

  it('paginates full commitment contributions with a scoped time and id cursor', async () => {
    const first = {
      id: '66666666-6666-4666-8666-666666666666', warehouse_id: '77777777-7777-4777-8777-777777777777',
      warehouse_name: 'Kho Bắc', quantity: '10.00', released_quantity: '1.00', issued_quantity: '2.00',
      delivered_quantity: '1.00', returned_quantity: '0.00', lost_quantity: '0.00',
      created_by_user_id: '88888888-8888-4888-8888-888888888888',
      created_at: '2026-10-13T00:00:00.000123Z', cursor_created_at: '2026-10-13T00:00:00.000123Z',
    };
    const query = jest.fn()
      .mockResolvedValueOnce([{ id: needId, organization_id: organizationId, region_code: 'HN', campaign_id: null, unit_scale: 2 }])
      .mockResolvedValueOnce([first, { ...first, id: '99999999-9999-4999-8999-999999999999' }])
      .mockResolvedValueOnce([{ id: needId, organization_id: organizationId, region_code: 'HN', campaign_id: null, unit_scale: 2 }])
      .mockResolvedValueOnce([]);
    const service = new NeedsQueriesService(
      { query } as unknown as DataSource,
      { require: jest.fn(async () => ({
        userId: needId,
        identityHeaders: {},
        grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId, region_code: null, campaign_id: null }],
      })) } as unknown as LogisticsSessionService,
    );

    const page = await service.contributions(needId, { limit: 1 }, {} as Request);
    expect(page).toMatchObject({
      more: true,
      items: [{ reserved_remaining: '7.00', issued_unsettled: '1.00', created_by_user_id: first.created_by_user_id }],
      cursor: expect.any(String),
    });
    expect(query.mock.calls[0]?.[0]).toContain('c.organization_id=$2');
    await expect(service.contributions(needId, { cursor: page.cursor as string, limit: 1 }, {} as Request)).resolves.toMatchObject({ items: [], more: false });
    expect(query.mock.calls[3]?.[0]).toContain('(cm.created_at,cm.id)>($2::timestamptz,$3::uuid)');
    expect((query.mock.calls[3]?.[1] as unknown[])[1]).toBe('2026-10-13T00:00:00.000123Z');
  });
});
