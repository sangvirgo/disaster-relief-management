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
        grants: [{ role_code: 'REVIEWER', scope_type: 'SYSTEM',}],
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

  it('rejects catalog writes from a campaign-scoped operations manager (catalog is SYSTEM-only)', async () => {
    const dataSource = { query: jest.fn(), transaction: jest.fn() };
    const idempotency = { execute: jest.fn() };
    const sessions = {
      require: jest.fn().mockResolvedValue({
        userId: '11111111-1111-4111-8111-111111111111',
        grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: '99999999-9999-4999-8999-999999999999' }],
        identityHeaders: { authorization: 'Bearer verified-token' },
      }),
    };
    const service = new CatalogService(dataSource as never, idempotency as never, sessions as never);

    await expect(service.createItemType({ code: 'FOOD', display_name: 'Thực phẩm' }, {
      method: 'POST', headers: {}, idempotencyKey: '33333333-3333-4333-8333-333333333333',
    } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(idempotency.execute).not.toHaveBeenCalled();
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

describe('Logistics catalog aliases', () => {
  const managerSession = {
    userId: '11111111-1111-4111-8111-111111111111',
    grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }],
    identityHeaders: { authorization: 'Bearer verified-token' },
  };
  const itemId = '22222222-2222-4222-8222-222222222222';
  const itemRow = {
    id: itemId, item_type_code: 'LUONG_THUC', item_type_name: 'Lương thực', unit_code: 'CAI', unit_name: 'cái', scale: 0,
    name: 'Mì gói', status: 'ACTIVE', version: 2, created_at: new Date('2026-11-18T00:00:00.000Z'), aliases: ['mì tôm'],
  };

  function setup(version = 2) {
    const sql: Array<{ text: string; values?: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (text: string, values?: unknown[]) => {
        sql.push({ text, values });
        if (text.startsWith('INSERT INTO item')) return [{ id: itemId }];
        if (text.includes('SELECT version FROM item')) return [{ version }];
        if (text.startsWith('UPDATE item SET aliases')) return [[{ id: itemId }], 1];
        if (text.includes('WHERE i.id = $1')) return [itemRow];
        throw new Error(`Unexpected SQL: ${text}`);
      }),
    };
    const idempotency = { execute: jest.fn(async (_source: unknown, command: { execute(m: unknown): Promise<unknown> }) => command.execute(manager)) };
    const sessions = { require: jest.fn().mockResolvedValue(managerSession) };
    const service = new CatalogService({} as never, idempotency as never, sessions as never);
    return { service, sql };
  }

  const request = { method: 'POST', headers: {}, idempotencyKey: '33333333-3333-4333-8333-333333333333' } as never;

  it('stores cleaned aliases (trimmed, NFC, de-duplicated) when an item is created and returns them', async () => {
    const { service, sql } = setup();

    const result = await service.createItem({ item_type_code: 'LUONG_THUC', unit_code: 'CAI', name: 'Mì gói', aliases: [' mì tôm ', 'mì tôm'] }, request);

    const insert = sql.find((entry) => entry.text.startsWith('INSERT INTO item'));
    expect(insert?.values?.[3]).toEqual(['mì tôm']);
    expect(result.value).toMatchObject({ aliases: ['mì tôm'] });
  });

  it('rejects an alias longer than 60 characters before writing', async () => {
    const { service, sql } = setup();

    await expect(service.createItem({ item_type_code: 'LUONG_THUC', unit_code: 'CAI', name: 'Mì gói', aliases: ['a'.repeat(61)] }, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(sql.some((entry) => entry.text.startsWith('INSERT INTO item'))).toBe(false);
  });

  it('replaces the alias list with the expected version and bumps the version', async () => {
    const { service, sql } = setup(2);

    const result = await service.updateItemAliases(itemId, { expected_version: 2, aliases: ['gạo', 'gạo'] }, request);

    const update = sql.find((entry) => entry.text.startsWith('UPDATE item SET aliases'));
    expect(update?.values).toEqual([itemId, ['gạo'], 2]);
    expect(result.value).toMatchObject({ id: itemId });
  });

  it('refuses a stale expected version with VERSION_CONFLICT and writes nothing', async () => {
    const { service, sql } = setup(3);

    await expect(service.updateItemAliases(itemId, { expected_version: 2, aliases: ['gạo'] }, request))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(sql.some((entry) => entry.text.startsWith('UPDATE item SET aliases'))).toBe(false);
  });
});
