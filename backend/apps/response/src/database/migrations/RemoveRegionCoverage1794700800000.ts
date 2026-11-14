import { MigrationInterface, QueryRunner } from 'typeorm';

// Region is removed from Response: no region boundaries, request/campaign/team region attribution,
// nationwide team coverage, or the region-based queue indexes. Organization FIFO indexes remain.
export class RemoveRegionCoverage1794700800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS request_org_region_fifo_idx');
    await queryRunner.query('DROP INDEX IF EXISTS request_unassigned_idx');
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN IF EXISTS region_code');
    await queryRunner.query('ALTER TABLE campaign DROP COLUMN IF EXISTS region_code');
    await queryRunner.query('ALTER TABLE rescue_team DROP COLUMN IF EXISTS operating_region_code');
    await queryRunner.query('ALTER TABLE rescue_team DROP COLUMN IF EXISTS nationwide_coverage');
    await queryRunner.query('DROP INDEX IF EXISTS region_boundary_geom_gix');
    await queryRunner.query('DROP TABLE IF EXISTS region_boundary');
  }

  // Irreversible: region boundaries and request/team attribution are not retained.
  async down(): Promise<void> {
    throw new Error('RemoveRegionCoverage1794700800000 cannot be reverted: region data is not retained');
  }
}
