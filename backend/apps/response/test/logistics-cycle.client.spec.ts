import { jest } from '@jest/globals';
import { AppError } from '@c48/technical/errors/errors';
import { LogisticsCycleClient } from '../src/integrations/logistics/logistics-cycle.client';

describe('LogisticsCycleClient', () => {
  it('sends a sealed-cycle command with the Logistics service token and outcome basis', async () => {
    const sessions = { serviceToken: jest.fn(async () => 'logistics-service-token') };
    const service = new LogisticsCycleClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 }, sessions as never);
    const post = jest.fn(async () => ({ status: 200, body: { state: 'SEALED' } }));
    (service as unknown as { client: { post: jest.Mock } }).client.post = post as unknown as jest.Mock;

    await expect(service.seal('40000000-0000-4000-8000-000000000001', 3, {
      intent_id: '50000000-0000-4000-8000-000000000001',
      outcome_basis: 'RESCUE_COMPLETED',
    })).resolves.toBeUndefined();

    expect(sessions.serviceToken).toHaveBeenCalledWith('logistics');
    expect(post).toHaveBeenCalledWith(
      '/api/v1/logistics/internal/requests/40000000-0000-4000-8000-000000000001/cycles/3/seal',
      { intent_id: '50000000-0000-4000-8000-000000000001', outcome_basis: 'RESCUE_COMPLETED' },
      { headers: { authorization: 'Bearer logistics-service-token' } },
    );
    service.onModuleDestroy();
  });

  it('preserves the documented Logistics settlement code and reasons from seal', async () => {
    const sessions = { serviceToken: jest.fn(async () => 'logistics-service-token') };
    const service = new LogisticsCycleClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 }, sessions as never);
    const post = jest.fn(async () => ({
      status: 409,
      body: { code: 'CYCLE_NOT_SETTLED', details: { reasons: ['OPEN_NEED', 'UNSETTLED_ISSUE'] } },
    }));
    (service as unknown as { client: { post: jest.Mock } }).client.post = post as unknown as jest.Mock;

    await expect(service.seal('40000000-0000-4000-8000-000000000001', 3, {
      intent_id: '50000000-0000-4000-8000-000000000001',
      outcome_basis: 'RESCUE_COMPLETED',
    })).rejects.toMatchObject({
      code: 'CYCLE_NOT_SETTLED',
      status: 409,
      details: { reasons: ['OPEN_NEED', 'UNSETTLED_ISSUE'] },
    } satisfies Partial<AppError>);
    service.onModuleDestroy();
  });

  it.each(['CYCLE_FROZEN', 'CYCLE_SEALED'])('propagates the documented %s conflict', async (code) => {
    const sessions = { serviceToken: jest.fn(async () => 'logistics-service-token') };
    const service = new LogisticsCycleClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 }, sessions as never);
    const post = jest.fn(async () => ({ status: 409, body: { code } }));
    (service as unknown as { client: { post: jest.Mock } }).client.post = post as unknown as jest.Mock;

    await expect(service.freeze('40000000-0000-4000-8000-000000000001', 3, {
      intent_id: '50000000-0000-4000-8000-000000000001',
    })).rejects.toMatchObject({ code, status: 409 } satisfies Partial<AppError>);
    service.onModuleDestroy();
  });

  it.each([
    ['invalid request id', 'not-a-uuid', 3, { intent_id: '50000000-0000-4000-8000-000000000001' }],
    ['invalid intent id', '40000000-0000-4000-8000-000000000001', 3, { intent_id: 'bad' }],
    ['invalid cycle', '40000000-0000-4000-8000-000000000001', 0, { intent_id: '50000000-0000-4000-8000-000000000001' }],
  ])('rejects %s before contacting Logistics', async (_label, requestId, cycle, command) => {
    const sessions = { serviceToken: jest.fn(async () => 'logistics-service-token') };
    const service = new LogisticsCycleClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 }, sessions as never);
    const post = jest.fn();
    (service as unknown as { client: { post: jest.Mock } }).client.post = post;

    await expect(service.freeze(requestId as string, cycle as number, command as { intent_id: string })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', status: 400,
    });
    expect(sessions.serviceToken).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('rejects a seal with an unknown outcome basis before contacting Logistics', async () => {
    const sessions = { serviceToken: jest.fn(async () => 'logistics-service-token') };
    const service = new LogisticsCycleClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 }, sessions as never);
    const post = jest.fn();
    (service as unknown as { client: { post: jest.Mock } }).client.post = post;

    await expect(service.seal('40000000-0000-4000-8000-000000000001', 3, {
      intent_id: '50000000-0000-4000-8000-000000000001', outcome_basis: 'OTHER',
    } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(post).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('maps unrecognized Logistics errors to the Vietnamese catalog boundary', async () => {
    const sessions = { serviceToken: jest.fn(async () => 'logistics-service-token') };
    const service = new LogisticsCycleClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 }, sessions as never);
    const post = jest.fn(async () => ({ status: 409, body: { code: 'UNEXPECTED_INTERNAL_TEXT', message: 'English internal error' } }));
    (service as unknown as { client: { post: jest.Mock } }).client.post = post as unknown as jest.Mock;

    await expect(service.unseal('40000000-0000-4000-8000-000000000001', 3, {
      intent_id: '50000000-0000-4000-8000-000000000001',
    })).rejects.toMatchObject({ code: 'LOGISTICS_UNAVAILABLE', status: 503 });
    service.onModuleDestroy();
  });
});
