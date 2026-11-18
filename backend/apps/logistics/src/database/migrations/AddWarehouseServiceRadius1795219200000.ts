import { MigrationInterface, QueryRunner } from 'typeorm';

// Warehouses already carry `location geography(Point,4326)` (nullable, from the baseline schema). This migration adds the
// service area radius and requires it together with the location (both NULL or both set). Existing located warehouses
// have no radius yet, so they receive the documented demo default before the pair CHECK is added.
const WAREHOUSE_DEFAULT_BACKFILL_RADIUS_M = 10_000;

export class AddWarehouseServiceRadius1795219200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE warehouse ADD COLUMN service_radius_m integer');
    await queryRunner.query(
      'UPDATE warehouse SET service_radius_m = $1 WHERE location IS NOT NULL AND service_radius_m IS NULL',
      [WAREHOUSE_DEFAULT_BACKFILL_RADIUS_M],
    );
    await queryRunner.query(`
      ALTER TABLE warehouse ADD CONSTRAINT warehouse_service_area_pair_check CHECK ((location IS NULL) = (service_radius_m IS NULL))
    `);
    await queryRunner.query(`
      ALTER TABLE warehouse ADD CONSTRAINT warehouse_service_radius_range_check
        CHECK (service_radius_m IS NULL OR (service_radius_m > 0 AND service_radius_m <= 200000))
    `);
    await queryRunner.query('CREATE INDEX warehouse_location_gist ON warehouse USING gist(location) WHERE location IS NOT NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS warehouse_location_gist');
    await queryRunner.query('ALTER TABLE warehouse DROP CONSTRAINT IF EXISTS warehouse_service_radius_range_check');
    await queryRunner.query('ALTER TABLE warehouse DROP CONSTRAINT IF EXISTS warehouse_service_area_pair_check');
    await queryRunner.query('ALTER TABLE warehouse DROP COLUMN IF EXISTS service_radius_m');
  }
}
