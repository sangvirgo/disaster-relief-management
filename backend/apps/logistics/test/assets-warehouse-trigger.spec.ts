import { describe, expect, it, jest } from '@jest/globals';
import { AssetsService } from '../src/assets/assets.service';
import { PatchWarehouseDto } from '../src/assets/assets.dto';

const warehouseId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '44444444-4444-4444-8444-444444444444';

const storedWarehouse = {
  id: warehouseId,
  name: 'Kho Demo',
  address_note: null,
  location_public: false,
  service_radius_m: 5000,
  longitude: 106.63,
  latitude: 10.82,
  status: 'ACTIVE',
  version: 1,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
};

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: warehouseId,
    name: 'Kho Demo',
    status: 'ACTIVE',
    version: 2,
    location: { type: 'Point', coordinates: [106.63, 10.82] },
    service_radius_m: 8000,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup(outcome: { replay: boolean; value: Record<string, unknown> }) {
  const query = jest.fn(async () => [storedWarehouse]);
  const sessions = { require: jest.fn().mockResolvedValue({
    userId: '11111111-1111-4111-8111-111111111111',
    grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }],
  }) };
  const idempotency = { execute: jest.fn(async () => ({ status: 200, ...outcome })) };
  const campaignWarehouses = { onWarehouseChanged: jest.fn(async () => undefined) };
  const service = new AssetsService({ query } as never, idempotency as never, sessions as never, campaignWarehouses as never);
  const request = { method: 'PATCH', headers: {}, idempotencyKey } as never;
  return { service, campaignWarehouses, request };
}

describe('warehouse commands notify campaign warehouse assignment', () => {
  it('passes the new service area on create, with no previous area', async () => {
    const { service, campaignWarehouses, request } = setup({ replay: false, value: view({ service_radius_m: 5000 }) });

    await service.createWarehouse({
      name: 'Kho Demo', location: { type: 'Point', coordinates: [106.63, 10.82] }, service_radius_m: 5000,
    } as never, request);

    expect(campaignWarehouses.onWarehouseChanged).toHaveBeenCalledWith({
      before: null,
      after: { warehouse_id: warehouseId, status: 'ACTIVE', location: { lat: 10.82, lng: 106.63 }, radius_m: 5000 },
    });
  });

  it('passes the previous and new service area when the radius is patched', async () => {
    const { service, campaignWarehouses, request } = setup({ replay: false, value: view() });

    await service.patchWarehouse(warehouseId, { expected_version: 1, service_radius_m: 8000 } as PatchWarehouseDto, request);

    expect(campaignWarehouses.onWarehouseChanged).toHaveBeenCalledWith({
      before: { warehouse_id: warehouseId, status: 'ACTIVE', location: { lat: 10.82, lng: 106.63 }, radius_m: 5000 },
      after: { warehouse_id: warehouseId, status: 'ACTIVE', location: { lat: 10.82, lng: 106.63 }, radius_m: 8000 },
    });
  });

  it('passes the deactivated status when a warehouse is deactivated', async () => {
    const { service, campaignWarehouses, request } = setup({ replay: false, value: view({ status: 'INACTIVE' }) });

    await service.deactivate('warehouse', warehouseId, { expected_version: 1 } as never, request);

    expect(campaignWarehouses.onWarehouseChanged).toHaveBeenCalledWith({
      before: { warehouse_id: warehouseId, status: 'ACTIVE', location: { lat: 10.82, lng: 106.63 }, radius_m: 5000 },
      after: { warehouse_id: warehouseId, status: 'INACTIVE', location: { lat: 10.82, lng: 106.63 }, radius_m: 8000 },
    });
  });

  it('does not re-run assignment when the command is a replay of an earlier result', async () => {
    const { service, campaignWarehouses, request } = setup({ replay: true, value: view() });

    await service.patchWarehouse(warehouseId, { expected_version: 1, service_radius_m: 8000 } as PatchWarehouseDto, request);

    expect(campaignWarehouses.onWarehouseChanged).not.toHaveBeenCalled();
  });
});
