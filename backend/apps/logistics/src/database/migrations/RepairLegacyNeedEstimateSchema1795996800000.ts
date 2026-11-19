import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddNeedEstimates was revised after some demo databases had already run its first shape.
 * TypeORM does not replay an applied migration, so upgrade that empty legacy norm table in place.
 * A populated legacy table needs a separately reviewed data conversion because its old
 * per-person/day quantities do not have an exact mapping to the new basis choices.
 */
export class RepairLegacyNeedEstimateSchema1795996800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasColumn('item', 'aliases')) {
      await queryRunner.query(`ALTER TABLE item
        ADD COLUMN aliases text[] NOT NULL DEFAULT '{}' CHECK (cardinality(aliases) <= 20)`);
      await queryRunner.query('CREATE INDEX item_aliases_gin_idx ON item USING gin (aliases)');
    }

    if (!await queryRunner.hasColumn('need_norm', 'qty_per_person_per_day')) return;
    if (await queryRunner.hasColumn('need_norm', 'qty_adult')) {
      throw new Error('Mixed legacy/current need_norm schema requires manual review');
    }
    const rows = await queryRunner.query('SELECT EXISTS (SELECT 1 FROM need_norm) AS has_data') as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) {
      throw new Error('Cannot convert populated legacy need_norm without a reviewed quantity mapping');
    }

    await queryRunner.query('ALTER TABLE need_norm DROP CONSTRAINT need_norm_category_item_type_code_key');
    await queryRunner.query('ALTER TABLE need_norm DROP CONSTRAINT need_norm_quantity_basis_check');
    await queryRunner.query(`ALTER TABLE need_norm
      DROP COLUMN qty_per_person_per_day,
      DROP COLUMN modifier_infant,
      DROP COLUMN modifier_elderly,
      ALTER COLUMN quantity_basis DROP DEFAULT,
      ADD COLUMN qty_adult numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_adult >= 0),
      ADD COLUMN qty_child numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_child >= 0),
      ADD COLUMN qty_elderly numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_elderly >= 0),
      ADD COLUMN people_per_unit integer NULL CHECK (people_per_unit >= 1),
      ADD COLUMN fixed_quantity numeric(12,3) NULL CHECK (fixed_quantity > 0),
      ADD COLUMN default_item_id uuid NULL REFERENCES item(id),
      ADD COLUMN in_default_bundle boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE need_norm
      ADD CONSTRAINT need_norm_category_uq UNIQUE (category),
      ADD CONSTRAINT need_norm_quantity_basis_check CHECK (quantity_basis IN ('BY_GROUP','PER_N_PEOPLE','PER_REQUEST')),
      ADD CONSTRAINT need_norm_basis_shape_check CHECK (
        (quantity_basis = 'BY_GROUP'
          AND (qty_adult > 0 OR qty_child > 0 OR qty_elderly > 0)
          AND people_per_unit IS NULL AND fixed_quantity IS NULL)
        OR (quantity_basis = 'PER_N_PEOPLE'
          AND people_per_unit IS NOT NULL AND fixed_quantity IS NULL
          AND qty_adult = 0 AND qty_child = 0 AND qty_elderly = 0)
        OR (quantity_basis = 'PER_REQUEST'
          AND fixed_quantity IS NOT NULL AND people_per_unit IS NULL
          AND qty_adult = 0 AND qty_child = 0 AND qty_elderly = 0)
      )`);
  }

  async down(): Promise<void> {
    throw new Error('Legacy need estimate schema repair is not reversible without losing current norm data');
  }
}
