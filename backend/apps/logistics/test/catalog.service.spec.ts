import { jest } from '@jest/globals';
import { encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { CatalogService } from '../src/catalog/catalog.service';
import { hasCatalogManageGrant } from '../src/catalog/catalog.helpers';

describe('Logistics catalog permissions', () => {
  it.each([
    ['timestamp', ['not-a-time'], '33333333-3333-4333-8333-333333333333'],
    ['id', ['2026-01-01T00:00:00.000Z'], 'not-a-uuid'],
  ] as const)('rejects an item cursor with an invalid %s before querying', async (_field, sort, id) => {
    const filters = { type: null, status: null, query: null };
    const cursor = encodeKeysetCursor(sort, id, filters);
    const dataSource = { query: jest.fn(async () => []) };
    const sessions = { require: jest.fn(async () => ({ userId: '11111111-1111-4111-8111-111111111111', grants: [] })) };
    const service = new CatalogService(dataSource as never, {} as never, sessions as never);

    await expect(service.items({ cursor }, { method: 'GET', headers: {} } as never))
      .rejects.toMatchObject({ code: 'CURSOR_INVALID', status: 400 });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('rejects catalog writes before opening an idempotent command without CATALOG_MANAGE', async () => {
    const dataSource = { query: jest.fn(), transaction: jest.fn() };
    const idempotency = { execute: jest.fn() };
    const sessions = {
      require: jest.fn().mockResolvedValue({
        userId: '11111111-1111-4111-8111-111111111111',
        grants: [{ role_code: 'INTAKE_STAFF', scope_type: 'SYSTEM',}],
        identityHeaders: { authorization: 'Bearer verified-token' },
      }),
    };
    const service = new CatalogService(dataSource as never, idempotency as never, sessions as never);

    await expect(service.createItemType({ code: 'FOOD', display_name: 'Thực phẩm' }, {
      method: 'POST', headers: {}, idempotencyKey: '33333333-3333-4333-8333-333333333333',
    } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(idempotency.execute).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('maps invalid Vietnamese catalog text to the existing validation error', async () => {
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM',}],
      identityHeaders: { authorization: 'Bearer verified-token' },
    }) };
    const idempotency = { execute: jest.fn() };
    const service = new CatalogService({ query: jest.fn() } as never, idempotency as never, sessions as never);

    await expect(service.createItemType({ code: 'FOOD', display_name: 'e\u0301' }, {
      method: 'POST', headers: {}, idempotencyKey: '33333333-3333-4333-8333-333333333333',
    } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('allows catalog management only through an operations-manager system grant', () => {
    const systemGrant = {
      role_code: 'OPERATIONS_MANAGER',
      scope_type: 'SYSTEM',
      campaign_id: null,
    } as const;
    expect(hasCatalogManageGrant([systemGrant])).toBe(true);
    expect(hasCatalogManageGrant([{ ...systemGrant, scope_type: 'CAMPAIGN', campaign_id: '22222222-2222-4222-8222-222222222222' }])).toBe(false);
    expect(hasCatalogManageGrant([{ ...systemGrant, role_code: 'ADMIN' }])).toBe(false);
  });
});
