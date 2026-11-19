import { MigrationInterface, QueryRunner } from 'typeorm';

// SOS goods demand: a relief_need row is DECLARED (entered by a person), ESTIMATED (generated from the norm table,
// awaiting coordinator review) or CONFIRMED (reviewed). Only DECLARED and CONFIRMED lines are demand for stock; ESTIMATED
// lines can never be committed. Existing rows were all entered by hand, so they default to DECLARED.
//
// need_norm holds one manager-editable norm per category (one estimate line per SOS per category). The quantity basis is:
//   BY_GROUP       quantity = adults*qty_adult + children*qty_child + elderly*qty_elderly (adults = people - children - elderly)
//   PER_N_PEOPLE   quantity = ceil(people / people_per_unit)
//   PER_REQUEST    quantity = fixed_quantity per SOS
// The quantity is rounded up to the item's unit scale by the application (pure function need-estimate.ts).
// default_item_id is the item used when the coordinator does not choose one. item.aliases supports the AI fallback
// matcher (matchAliases) and is never a source of quantities.
export class AddNeedEstimates1795392000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE relief_need
      ADD COLUMN source text NOT NULL DEFAULT 'DECLARED' CHECK (source IN ('DECLARED','ESTIMATED','CONFIRMED')),
      ADD COLUMN estimate_basis jsonb`);
    await queryRunner.query(`ALTER TABLE relief_need ADD CONSTRAINT relief_need_estimate_basis_check
      CHECK (source <> 'ESTIMATED' OR estimate_basis IS NOT NULL)`);
    await queryRunner.query(`CREATE TABLE need_norm (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      category text NOT NULL CHECK (category ~ '^[A-Z0-9_]{2,40}$'),
      item_type_code text NOT NULL REFERENCES item_type(code),
      quantity_basis text NOT NULL CHECK (quantity_basis IN ('BY_GROUP','PER_N_PEOPLE','PER_REQUEST')),
      qty_adult numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_adult >= 0),
      qty_child numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_child >= 0),
      qty_elderly numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_elderly >= 0),
      people_per_unit integer NULL CHECK (people_per_unit >= 1),
      fixed_quantity numeric(12,3) NULL CHECK (fixed_quantity > 0),
      default_item_id uuid NULL REFERENCES item(id),
      in_default_bundle boolean NOT NULL DEFAULT true,
      active boolean NOT NULL DEFAULT true,
      version int NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT need_norm_category_uq UNIQUE (category),
      CONSTRAINT need_norm_basis_shape_check CHECK (
        (quantity_basis = 'BY_GROUP'
          AND (qty_adult > 0 OR qty_child > 0 OR qty_elderly > 0)
          AND people_per_unit IS NULL AND fixed_quantity IS NULL)
        OR (quantity_basis = 'PER_N_PEOPLE'
          AND people_per_unit IS NOT NULL AND fixed_quantity IS NULL
          AND qty_adult = 0 AND qty_child = 0 AND qty_elderly = 0)
        OR (quantity_basis = 'PER_REQUEST'
          AND fixed_quantity IS NOT NULL AND people_per_unit IS NULL
          AND qty_adult = 0 AND qty_child = 0 AND qty_elderly = 0)
      )
    )`);
    await queryRunner.query(`ALTER TABLE item
      ADD COLUMN aliases text[] NOT NULL DEFAULT '{}' CHECK (cardinality(aliases) <= 20)`);
    await queryRunner.query('CREATE INDEX item_aliases_gin_idx ON item USING gin (aliases)');
    // Tables created by migrations do not inherit the application grants from the baseline schema, so grant them here.
    // Guarded so databases without the application role (for example a migration-only check) still migrate.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE ON need_norm TO c48_logistics_app;
      END IF;
    END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(`SELECT EXISTS (SELECT 1 FROM relief_need WHERE source <> 'DECLARED') AS has_data`);
    if (rows[0]?.has_data) throw new Error('Cannot roll back need estimates while ESTIMATED or CONFIRMED needs exist');
    await queryRunner.query('DROP TABLE IF EXISTS need_norm');
    await queryRunner.query('DROP INDEX IF EXISTS item_aliases_gin_idx');
    await queryRunner.query('ALTER TABLE item DROP COLUMN IF EXISTS aliases');
    await queryRunner.query('ALTER TABLE relief_need DROP CONSTRAINT IF EXISTS relief_need_estimate_basis_check');
    await queryRunner.query('ALTER TABLE relief_need DROP COLUMN IF EXISTS estimate_basis');
    await queryRunner.query('ALTER TABLE relief_need DROP COLUMN IF EXISTS source');
  }
}
