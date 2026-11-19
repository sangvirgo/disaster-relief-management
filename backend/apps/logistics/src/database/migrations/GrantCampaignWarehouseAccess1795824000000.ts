import { MigrationInterface, QueryRunner } from 'typeorm';

/** Campaign warehouse tables were added after the baseline app-role grants. */
export class GrantCampaignWarehouseAccess1795824000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_area_snapshot, campaign_warehouse TO c48_logistics_app;
      END IF;
    END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        REVOKE SELECT, INSERT, UPDATE, DELETE ON campaign_area_snapshot, campaign_warehouse FROM c48_logistics_app;
      END IF;
    END $$`);
  }
}
