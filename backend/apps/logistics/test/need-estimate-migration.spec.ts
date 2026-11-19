import { describe, expect, it, jest } from '@jest/globals';
import { AddNeedEstimates1795392000000 } from '../src/database/migrations/AddNeedEstimates1795392000000';

describe('need estimates migration', () => {
  it('creates need_norm with one norm per category, basis-shaped CHECKs and default item and bundle columns', async () => {
    const query = jest.fn(async () => [] as unknown[]);
    await new AddNeedEstimates1795392000000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain("CHECK (quantity_basis IN ('BY_GROUP','PER_N_PEOPLE','PER_REQUEST'))");
    expect(sql).toContain('CONSTRAINT need_norm_category_uq UNIQUE (category)');
    expect(sql).toContain('item_type_code text NOT NULL REFERENCES item_type(code)');
    expect(sql).toContain('qty_adult numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_adult >= 0)');
    expect(sql).toContain('people_per_unit integer NULL CHECK (people_per_unit >= 1)');
    expect(sql).toContain('fixed_quantity numeric(12,3) NULL CHECK (fixed_quantity > 0)');
    expect(sql).toContain('default_item_id uuid NULL REFERENCES item(id)');
    expect(sql).toContain('in_default_bundle boolean NOT NULL DEFAULT true');
    expect(sql).toContain('CONSTRAINT need_norm_basis_shape_check');
    expect(sql).toContain("quantity_basis = 'PER_N_PEOPLE'");
    expect(sql).toContain("quantity_basis = 'PER_REQUEST'");
  });

  it('keeps the relief_need estimate columns and adds item aliases with a bounded array and a GIN index', async () => {
    const query = jest.fn(async () => [] as unknown[]);
    await new AddNeedEstimates1795392000000().up({ query } as never);
    const statements = query.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((sql) => sql.includes("source text NOT NULL DEFAULT 'DECLARED'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CHECK (source <> 'ESTIMATED' OR estimate_basis IS NOT NULL)"))).toBe(true);
    expect(statements.some((sql) => sql.includes("ADD COLUMN aliases text[] NOT NULL DEFAULT '{}' CHECK (cardinality(aliases) <= 20)"))).toBe(true);
    expect(statements).toContain('CREATE INDEX item_aliases_gin_idx ON item USING gin (aliases)');
  });

  it('guards the application grant and never grants on a missing role', async () => {
    const query = jest.fn(async () => [] as unknown[]);
    await new AddNeedEstimates1795392000000().up({ query } as never);
    const grant = query.mock.calls.map(([statement]) => String(statement)).find((sql) => sql.includes('GRANT SELECT, INSERT, UPDATE ON need_norm'));
    expect(grant).toContain("IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app')");
  });

  it('refuses to roll back while estimated or confirmed needs exist, then reverts only what it added', async () => {
    const blocked = jest.fn(async () => [{ has_data: true }] as unknown[]);
    await expect(new AddNeedEstimates1795392000000().down({ query: blocked } as never)).rejects.toThrow('Cannot roll back need estimates');

    const query = jest.fn(async (statement: string) => (statement.includes('has_data') ? [{ has_data: false }] : []) as unknown[]);
    await new AddNeedEstimates1795392000000().down({ query } as never);
    const statements = query.mock.calls.map(([statement]) => String(statement));
    expect(statements).toContain('DROP TABLE IF EXISTS need_norm');
    expect(statements).toContain('ALTER TABLE item DROP COLUMN IF EXISTS aliases');
    expect(statements.some((sql) => /DROP COLUMN IF EXISTS (location|name|status)|DELETE FROM|UPDATE item/u.test(sql))).toBe(false);
  });
});
