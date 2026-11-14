import { MigrationInterface, QueryRunner } from 'typeorm';

// Region is removed from Logistics: warehouse, relief point, vehicle and fulfillment cycle no longer
// carry region_code. Scope indexes are rebuilt by organization (plus ACTIVE status) only.
export class RemoveRegionAttribution1794700800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS warehouse_scope_idx');
    await queryRunner.query('DROP INDEX IF EXISTS relief_point_scope_idx');
    await queryRunner.query('DROP INDEX IF EXISTS cycle_region_idx');
    await queryRunner.query('ALTER TABLE warehouse DROP COLUMN IF EXISTS region_code');
    await queryRunner.query('ALTER TABLE relief_point DROP COLUMN IF EXISTS region_code');
    await queryRunner.query('ALTER TABLE vehicle DROP COLUMN IF EXISTS region_code');
    await queryRunner.query('ALTER TABLE fulfillment_cycle DROP COLUMN IF EXISTS region_code');
    await queryRunner.query("CREATE INDEX warehouse_scope_idx ON warehouse (organization_id) WHERE status = 'ACTIVE'");
    await queryRunner.query("CREATE INDEX relief_point_scope_idx ON relief_point (organization_id) WHERE status = 'ACTIVE'");
  }

  // Irreversible: region attribution is not retained.
  async down(): Promise<void> {
    throw new Error('RemoveRegionAttribution1794700800000 cannot be reverted: region data is not retained');
  }
}
