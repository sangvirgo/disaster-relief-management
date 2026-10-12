import { jest } from '@jest/globals';
import { CatalogService } from '../src/catalog/catalog.service';
import { hasCatalogManageGrant } from '../src/catalog/catalog.helpers';

describe('Logistics catalog permissions', () => {
  it('rejects catalog writes before opening an idempotent command without CATALOG_MANAGE', async () => {
    const dataSource = { query: jest.fn(), transaction: jest.fn() };
    const idempotency = { execute: jest.fn() };
    const sessions = {
      require: jest.fn().mockResolvedValue({
        userId: '11111111-1111-4111-8111-111111111111',
        grants: [{ role_code: 'INTAKE_STAFF', scope_type: 'ORGANIZATION', organization_id: '22222222-2222-4222-8222-222222222222' }],
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
      grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: '22222222-2222-4222-8222-222222222222' }],
      identityHeaders: { authorization: 'Bearer verified-token' },
    }) };
    const idempotency = { execute: jest.fn() };
    const service = new CatalogService({ query: jest.fn() } as never, idempotency as never, sessions as never);

    await expect(service.createItemType({ code: 'FOOD', display_name: 'e\u0301' }, {
      method: 'POST', headers: {}, idempotencyKey: '33333333-3333-4333-8333-333333333333',
    } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('allows catalog management only through an operations-manager organization grant', () => {
    const organizationGrant = {
      role_code: 'OPERATIONS_MANAGER',
      scope_type: 'ORGANIZATION',
      organization_id: '22222222-2222-4222-8222-222222222222',
      region_code: null,
      campaign_id: null,
    } as const;
    expect(hasCatalogManageGrant([organizationGrant])).toBe(true);
    expect(hasCatalogManageGrant([{ ...organizationGrant, scope_type: 'REGION', region_code: 'R01' }])).toBe(false);
    expect(hasCatalogManageGrant([{ ...organizationGrant, scope_type: 'SYSTEM', organization_id: null }])).toBe(false);
    expect(hasCatalogManageGrant([{ ...organizationGrant, role_code: 'ADMIN' }])).toBe(false);
  });
});
