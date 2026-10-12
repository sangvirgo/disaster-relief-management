import { jest } from '@jest/globals';
import { AssetsService } from '../src/assets/assets.service';

describe('Logistics asset scope', () => {
  it('rejects an out-of-scope organization and region before region lookup or transaction', async () => {
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      grants: [{
        role_code: 'OPERATIONS_MANAGER',
        scope_type: 'REGION',
        organization_id: '22222222-2222-4222-8222-222222222222',
        region_code: 'R01',
      }],
      identityHeaders: { authorization: 'Bearer verified-token' },
    }) };
    const identity = { assertActiveRegion: jest.fn() };
    const idempotency = { execute: jest.fn() };
    const service = new AssetsService({ query: jest.fn() } as never, idempotency as never, sessions as never, identity as never);

    await expect(service.createWarehouse({
      organization_id: '33333333-3333-4333-8333-333333333333',
      region_code: 'R02',
      name: 'Kho cứu trợ',
    }, {
      method: 'POST', headers: {}, idempotencyKey: '44444444-4444-4444-8444-444444444444',
    } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(identity.assertActiveRegion).not.toHaveBeenCalled();
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('validates the live region before claiming the create idempotency key', async () => {
    const events: string[] = [];
    const session = {
      userId: '11111111-1111-4111-8111-111111111111',
      grants: [{
        role_code: 'OPERATIONS_MANAGER',
        scope_type: 'REGION',
        organization_id: '22222222-2222-4222-8222-222222222222',
        region_code: 'R01',
      }],
      identityHeaders: { authorization: 'Bearer verified-token' },
    };
    const sessions = { require: jest.fn().mockResolvedValue(session) };
    const identity = { assertActiveRegion: jest.fn(async () => { events.push('region'); }) };
    const idempotency = { execute: jest.fn(async () => { events.push('idempotency'); return { status: 201, value: {}, replay: false }; }) };
    const service = new AssetsService({ query: jest.fn() } as never, idempotency as never, sessions as never, identity as never);

    await service.createWarehouse({
      organization_id: '22222222-2222-4222-8222-222222222222',
      region_code: 'R01',
      name: 'Kho cứu trợ',
    }, {
      method: 'POST', headers: {}, idempotencyKey: '44444444-4444-4444-8444-444444444444',
    } as never);

    expect(identity.assertActiveRegion).toHaveBeenCalledWith('R01', session.identityHeaders);
    expect(events).toEqual(['region', 'idempotency']);
  });
});
