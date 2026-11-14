import { jest } from '@jest/globals';
import { AssetsService } from '../src/assets/assets.service';

describe('Logistics asset scope', () => {
  it('rejects a campaign grant on an organization-only warehouse before any transaction', async () => {
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      grants: [{
        role_code: 'OPERATIONS_MANAGER',
        scope_type: 'CAMPAIGN',
        campaign_id: '99999999-9999-4999-8999-999999999999',
      }],
      identityHeaders: { authorization: 'Bearer verified-token' },
    }) };
    const idempotency = { execute: jest.fn() };
    const service = new AssetsService({ query: jest.fn() } as never, idempotency as never, sessions as never, {} as never);

    await expect(service.createWarehouse({
      organization_id: '33333333-3333-4333-8333-333333333333',
      name: 'Kho cứu trợ',
    }, {
      method: 'POST', headers: {}, idempotencyKey: '44444444-4444-4444-8444-444444444444',
    } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });
});
