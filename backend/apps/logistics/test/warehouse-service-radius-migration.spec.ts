import { describe, expect, it, jest } from '@jest/globals';
import { AddWarehouseServiceRadius1795219200000 } from '../src/database/migrations/AddWarehouseServiceRadius1795219200000';

describe('warehouse service radius migration', () => {
  it('adds the radius with a pair check, range check, backfill and GIST index on the existing location', async () => {
    const query = jest.fn(async () => undefined);
    await new AddWarehouseServiceRadius1795219200000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('ALTER TABLE warehouse ADD COLUMN service_radius_m integer');
    expect(statements.some((sql) => sql.includes('(location IS NULL) = (service_radius_m IS NULL)'))).toBe(true);
    expect(statements.some((sql) => sql.includes('service_radius_m > 0 AND service_radius_m <= 200000'))).toBe(true);
    expect(statements.some((sql) => sql.includes('USING gist(location) WHERE location IS NOT NULL'))).toBe(true);
    const backfillIndex = statements.findIndex((sql) => sql.startsWith('UPDATE warehouse SET service_radius_m'));
    const pairIndex = statements.findIndex((sql) => sql.includes('warehouse_service_area_pair_check'));
    expect(backfillIndex).toBeGreaterThan(-1);
    expect(backfillIndex).toBeLessThan(pairIndex);
    expect(query.mock.calls[backfillIndex]?.[1]).toEqual([10000]);
  });

  it('reverts only the structures it added and never touches location or other rows', async () => {
    const query = jest.fn(async () => undefined);
    await new AddWarehouseServiceRadius1795219200000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('ALTER TABLE warehouse DROP COLUMN IF EXISTS service_radius_m');
    expect(statements.some((sql) => /DROP COLUMN IF EXISTS location|DELETE|UPDATE/u.test(sql))).toBe(false);
  });
});
