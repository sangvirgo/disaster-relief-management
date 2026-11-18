import { MigrationInterface, QueryRunner } from 'typeorm';

// SOS goods demand: a relief_need row is DECLARED (entered by a person), ESTIMATED (generated from the norm table,
// awaiting coordinator review) or CONFIRMED (reviewed). Only DECLARED and CONFIRMED lines are demand for stock; ESTIMATED
// lines can never be committed. Existing rows were all entered by hand, so they default to DECLARED.
// need_norm holds the configurable per-person norms. `quantity_basis` says whether the norm is per person per day
// (multiplied by the number of days) or per person (a one-off need such as a blanket or a first-aid kit).
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
      quantity_basis text NOT NULL DEFAULT 'PER_PERSON_DAY' CHECK (quantity_basis IN ('PER_PERSON_DAY','PER_PERSON')),
      qty_per_person_per_day numeric(12,3) NOT NULL CHECK (qty_per_person_per_day > 0),
      modifier_infant numeric(5,2) NOT NULL DEFAULT 0 CHECK (modifier_infant >= 0 AND modifier_infant <= 10),
      modifier_elderly numeric(5,2) NOT NULL DEFAULT 0 CHECK (modifier_elderly >= 0 AND modifier_elderly <= 10),
      active boolean NOT NULL DEFAULT true,
      version int NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (category, item_type_code)
    )`);
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
    await queryRunner.query('ALTER TABLE relief_need DROP CONSTRAINT IF EXISTS relief_need_estimate_basis_check');
    await queryRunner.query('ALTER TABLE relief_need DROP COLUMN IF EXISTS estimate_basis');
    await queryRunner.query('ALTER TABLE relief_need DROP COLUMN IF EXISTS source');
  }
}
