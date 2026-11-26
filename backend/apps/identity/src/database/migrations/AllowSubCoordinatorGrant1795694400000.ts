import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sub-coordinator (2026-11-26): the existing COORDINATOR role granted at CAMPAIGN scope without a campaign. Response
 * limits it to the ACTIVE campaigns the holder engages itself and to a narrower permission set. No role is added.
 * Rollback revokes such grants (audit rows stay) and bumps the holders' authz versions before restoring the check.
 */
export class AllowSubCoordinatorGrant1795694400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS scope_shape');
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT scope_shape CHECK (
        (scope_type = 'SYSTEM' AND campaign_id IS NULL) OR
        (scope_type = 'CAMPAIGN' AND (campaign_id IS NOT NULL OR role_code = 'COORDINATOR')))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE app_user SET authz_version = authz_version + 1, version = version + 1
       WHERE id IN (SELECT user_id FROM role_grant WHERE scope_type = 'CAMPAIGN' AND campaign_id IS NULL AND revoked_at IS NULL)
    `);
    await queryRunner.query(`
      UPDATE role_grant SET revoked_at = now() WHERE scope_type = 'CAMPAIGN' AND campaign_id IS NULL AND revoked_at IS NULL
    `);
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS scope_shape');
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT scope_shape CHECK (
        (scope_type = 'SYSTEM' AND campaign_id IS NULL) OR
        (scope_type = 'CAMPAIGN' AND campaign_id IS NOT NULL)) NOT VALID
    `);
  }
}
