import 'reflect-metadata';
import { jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssetsService } from '../src/assets/assets.service';
import { CreateWarehouseDto, PatchWarehouseDto } from '../src/assets/assets.dto';

const warehouseId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '44444444-4444-4444-8444-444444444444';
const point = { type: 'Point', coordinates: [106.63, 10.82] };

function setup(storedRow: Record<string, unknown> | null = null) {
  const query = jest.fn(async () => (storedRow ? [storedRow] : []));
  const sessions = { require: jest.fn().mockResolvedValue({
    userId: '11111111-1111-4111-8111-111111111111',
    grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }],
  }) };
  const idempotency = {
    execute: jest.fn(async (_dataSource: unknown, options: { execute: (manager: unknown) => Promise<unknown> }) =>
      options.execute({ query })),
  };
  const campaignWarehouses = { onWarehouseChanged: jest.fn(async () => undefined) };
  const service = new AssetsService({ query } as never, idempotency as never, sessions as never, campaignWarehouses as never);
  const request = { method: 'POST', headers: {}, idempotencyKey } as never;
  return { service, idempotency, request };
}

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

describe('warehouse service area (location and service_radius_m)', () => {
  it('rejects a location without a radius before any transaction, with a Vietnamese message and field codes', async () => {
    const { service, idempotency, request } = setup();
    const error = await service.createWarehouse({ name: 'Kho A', location: point } as CreateWarehouseDto, request)
      .catch((caught: unknown) => caught) as { code: string; userMessage: string; fieldErrors: Record<string, string[]> };
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.userMessage).toContain('bán kính');
    expect(error.fieldErrors.service_radius_m).toEqual(['WAREHOUSE_SERVICE_AREA_PAIR_REQUIRED']);
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('rejects a radius without a location before any transaction', async () => {
    const { service, idempotency, request } = setup();
    await expect(service.createWarehouse({ name: 'Kho A', service_radius_m: 5000 } as CreateWarehouseDto, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('creates a warehouse with both location and radius, persisting the radius', async () => {
    const { service, idempotency, request } = setup({ ...storedWarehouse });
    await service.createWarehouse({ name: 'Kho A', location: point, service_radius_m: 5000 } as CreateWarehouseDto, request);
    expect(idempotency.execute).toHaveBeenCalledTimes(1);
  });

  it('creates a warehouse with neither location nor radius (existing behaviour)', async () => {
    const { service, idempotency, request } = setup({ ...storedWarehouse, longitude: null, latitude: null, service_radius_m: null });
    await service.createWarehouse({ name: 'Kho A' } as CreateWarehouseDto, request);
    expect(idempotency.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a patch that clears the location while the stored radius remains set', async () => {
    const { service, request } = setup(storedWarehouse);
    await expect(service.patchWarehouse(warehouseId, { expected_version: 1, location: null } as PatchWarehouseDto, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { location: ['WAREHOUSE_SERVICE_AREA_PAIR_REQUIRED'] } });
  });

  it('rejects a patch that sets a radius on a warehouse without a stored location', async () => {
    const { service, request } = setup({ ...storedWarehouse, longitude: null, latitude: null, service_radius_m: null });
    await expect(service.patchWarehouse(warehouseId, { expected_version: 1, service_radius_m: 8000 } as PatchWarehouseDto, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('accepts a patch that changes only the radius of a warehouse that already has a location', async () => {
    const { service, request } = setup(storedWarehouse);
    await expect(service.patchWarehouse(warehouseId, { expected_version: 1, service_radius_m: 8000 } as PatchWarehouseDto, request))
      .resolves.toBeDefined();
  });
});

describe('warehouse service radius DTO validation', () => {
  const validateWarehouse = (body: Record<string, unknown>) =>
    validate(plainToInstance(CreateWarehouseDto, { name: 'Kho A', ...body }));

  it.each([1, 5000, 200000])('accepts radius %p metres', async (radius) => {
    await expect(validateWarehouse({ location: point, service_radius_m: radius })).resolves.toHaveLength(0);
  });

  it.each([0, -5, 200001, 1.5, '5000'])('rejects radius %p', async (radius) => {
    const errors = await validateWarehouse({ location: point, service_radius_m: radius });
    expect(errors.map((error) => error.property)).toContain('service_radius_m');
  });

  it('accepts null radius on patch (clearing) and rejects out-of-range values', async () => {
    const ok = await validate(plainToInstance(PatchWarehouseDto, { expected_version: 1, location: null, service_radius_m: null }));
    expect(ok).toHaveLength(0);
    const bad = await validate(plainToInstance(PatchWarehouseDto, { expected_version: 1, service_radius_m: 250000 }));
    expect(bad.map((error) => error.property)).toContain('service_radius_m');
  });
});
