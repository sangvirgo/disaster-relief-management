import { describe, expect, it, jest } from '@jest/globals';
import { AddCampaignWarehouseAssignment1795478400000 } from '../src/database/migrations/AddCampaignWarehouseAssignment1795478400000';

describe('campaign warehouse assignment migration', () => {
  it('creates the assignment table, the single-primary partial unique index and the area snapshot with a GIST index', async () => {
    const query = jest.fn(async () => undefined);
    await new AddCampaignWarehouseAssignment1795478400000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('CREATE TABLE campaign_warehouse ('))).toBe(true);
    expect(statements.some((sql) => sql.includes("REFERENCES warehouse(id)") && sql.includes("CHECK (role IN ('PRIMARY','BACKUP'))"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CHECK (source IN ('AUTO','MANUAL'))"))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE UNIQUE INDEX campaign_warehouse_one_primary_uq ON campaign_warehouse (campaign_id) WHERE role = \'PRIMARY\''))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE campaign_area_snapshot ('))).toBe(true);
    expect(statements.some((sql) => sql.includes('center geography(Point,4326)'))).toBe(true);
    expect(statements.some((sql) => sql.includes('USING gist(center)'))).toBe(true);
  });

  it('drops only the two tables it created', async () => {
    const query = jest.fn(async () => undefined);
    await new AddCampaignWarehouseAssignment1795478400000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toEqual([
      'DROP TABLE IF EXISTS campaign_warehouse',
      'DROP TABLE IF EXISTS campaign_area_snapshot',
    ]);
  });
});
