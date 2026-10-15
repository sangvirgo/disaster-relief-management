import type { Request } from 'express';
import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import type { Grant } from '../../../packages/technical/src/security/permissions';
import { MapService } from '../src/map/map.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const from = '2026-01-01T00:00:00Z';
const to = '2026-01-02T00:00:00Z';
const coordinatorGrant: Grant = { role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId };

function setup(rows: unknown[] = [], projectionEpsg = 32648) {
  const query = jest.fn(async () => rows);
  const validateProjection = jest.fn(async () => [{ srid: projectionEpsg }]);
  const dataSource = {
    query: validateProjection,
    transaction: jest.fn(async (operation: (manager: { query: typeof query }) => Promise<unknown>) => operation({ query })),
  } as unknown as DataSource;
  const sessions = { require: jest.fn(async () => ({ userId, grants: [coordinatorGrant] })) };
  const service = new MapService(dataSource, sessions as never, { projectionEpsg });
  return { service, query, dataSource, sessions, validateProjection };
}

describe('MapService heatmap', () => {
  it('requires a region or campaign filter before querying', async () => {
    const { service, dataSource } = setup();

    await expect(service.heatmap({ from, to }, {} as Request)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { from: '2026-01-01T00:00:00+07:00', to },
    { from: to, to: from },
    { from, to: '2026-02-02T00:00:00Z' },
  ])('rejects invalid, reversed, or overlong UTC windows', async (window) => {
    const { service, dataSource } = setup();

    await expect(service.heatmap({ ...window, region_code: 'VN01' }, {} as Request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('requires queue scope as well as map scope for the unverified layer', async () => {
    const { service, dataSource, sessions } = setup();
    sessions.require.mockResolvedValue({
      userId,
      grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: organizationId }],
    });

    await expect(service.heatmap({ from, to, region_code: 'VN01', status_layer: 'unverified' }, {} as Request))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('returns only aggregate GeoJSON and applies scope before bounded aggregation', async () => {
    const { service, query, dataSource } = setup([
      { cell: '{"type":"Polygon","coordinates":[]}', center: '{"type":"Point","coordinates":[]}', count: '7' },
    ]);

    const result = await service.heatmap({ from, to, region_code: 'VN01', category: 'FLOOD' }, {} as Request);

    expect(result).toMatchObject({
      items: [{ cell: { type: 'Polygon' }, center: { type: 'Point' }, count: 7 }],
      filters: { from, to, status_layer: 'confirmed', region_code: 'VN01', campaign_id: null, category: 'FLOOD', cell_m: 1000 },
    });
    expect(Object.keys((result as { items: Array<Record<string, unknown>> }).items[0]!).sort()).toEqual(['cell', 'center', 'count']);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![0]).toBe("SET LOCAL statement_timeout = '5s'");
    const sql = query.mock.calls[1]![0] as string;
    expect(sql).toContain('ST_SnapToGrid');
    expect(sql).toContain('JOIN request_subject s ON s.request_id=r.id');
    expect(sql).toContain('ST_Transform(s.location::geometry, 32648)');
    expect(sql).toContain('ST_Transform(ST_MakeEnvelope');
    expect(sql).toContain('ST_ForcePolygonCCW');
    expect(sql).toContain('ST_Transform(center, 4326)');
    expect(sql).toContain('LIMIT 5001');
    expect(sql).toContain('r.organization_id=$');
    expect(sql).toContain('r.region_code=$');
    expect(sql).not.toMatch(/\bSELECT\s+(?:r\.)?id\b|reporter_contact_phone|tracking_code/i);
  });

  it('uses the configured projection EPSG in its SQL', async () => {
    const { service, query } = setup([], 3857);

    await service.heatmap({ from, to, region_code: 'VN01' }, {} as Request);

    expect(query.mock.calls[1]![0]).toContain('3857');
    expect(query.mock.calls[1]![0]).not.toContain('32648');
  });

  it('accepts only matching EPSG projected coordinate systems with metre units', async () => {
    const { service, validateProjection } = setup();

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    const [sql, values] = validateProjection.mock.calls[0]! as unknown as [string, unknown[]];
    expect(sql).toContain("auth_name='EPSG'");
    expect(sql).toContain('auth_srid=srid');
    expect(sql).toContain("srtext LIKE 'PROJCS[%'");
    expect(sql).toContain("srtext LIKE 'PROJCRS[%'");
    expect(sql).toContain('UNIT');
    expect(sql).toContain('LENGTHUNIT');
    expect(values).toEqual([32648]);
  });

  it('rejects projections that are missing or do not use metres', async () => {
    const { service, validateProjection } = setup([], 4326);
    validateProjection.mockResolvedValue([]);

    await expect(service.onModuleInit()).rejects.toThrow('MAP_PROJECTION_EPSG');
  });

  it('fails instead of returning a partial map when the cell cap is exceeded', async () => {
    const cells = Array.from({ length: 5001 }, () => ({ cell: '{}', center: '{}', count: 1 }));
    const { service } = setup(cells);

    await expect(service.heatmap({ from, to, campaign_id: '00000000-0000-4000-8000-000000000003' }, {} as Request))
      .rejects.toMatchObject({ code: 'TOO_MANY_CELLS', status: 400 });
  });

  it('reuses authorized identical results from its short-lived cache', async () => {
    const { service, query, sessions } = setup([]);

    const first = await service.heatmap({ from, to, region_code: 'VN01' }, {} as Request);
    const second = await service.heatmap({ from, to, region_code: 'VN01' }, {} as Request);

    expect(second).toEqual(first);
    expect(sessions.require).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
