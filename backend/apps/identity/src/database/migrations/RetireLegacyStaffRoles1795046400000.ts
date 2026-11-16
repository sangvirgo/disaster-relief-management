import { MigrationInterface, QueryRunner } from 'typeorm';

const ZERO_CAMPAIGN = '00000000-0000-0000-0000-000000000000';
const OLD_ROLE_CODES = `'CITIZEN','VOLUNTEER','COORDINATOR','CAMPAIGN_COORDINATOR','CAMPAIGN_MANAGER',
        'OPERATIONS_MANAGER','INTAKE_STAFF','REVIEWER','DISTRIBUTION_STAFF','ADMIN'`;
const NEW_ROLE_CODES = `'CITIZEN','VOLUNTEER','COORDINATOR','CAMPAIGN_COORDINATOR',
        'OPERATIONS_MANAGER','REVIEWER','ADMIN'`;

/**
 * Retires CAMPAIGN_MANAGER, INTAKE_STAFF and DISTRIBUTION_STAFF.
 * - CAMPAIGN_MANAGER grants move to COORDINATOR with the same scope and campaign (COORDINATOR is a superset).
 * - INTAKE_STAFF grants move to OPERATIONS_MANAGER with the same scope and campaign (OPERATIONS_MANAGER is a superset).
 * - DISTRIBUTION_STAFF grants are deleted; their holders must be re-granted OPERATIONS_MANAGER explicitly.
 * Live grants that would collide with an existing live target grant are revoked (history kept), not merged.
 * Rollback restores the old role catalog only; retired grants are not restored.
 */
export class RetireLegacyStaffRoles1795046400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE app_user SET authz_version = authz_version + 1, version = version + 1
       WHERE id IN (
         SELECT user_id FROM role_grant
          WHERE role_code IN ('CAMPAIGN_MANAGER','INTAKE_STAFF','DISTRIBUTION_STAFF')
       )
    `);
    await queryRunner.query(`DELETE FROM role_grant WHERE role_code = 'DISTRIBUTION_STAFF'`);
    await queryRunner.query(`
      UPDATE role_grant src SET revoked_at = now()
       WHERE src.role_code IN ('CAMPAIGN_MANAGER','INTAKE_STAFF') AND src.revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM role_grant target
            WHERE target.user_id = src.user_id AND target.revoked_at IS NULL
              AND target.role_code = CASE src.role_code WHEN 'CAMPAIGN_MANAGER' THEN 'COORDINATOR' ELSE 'OPERATIONS_MANAGER' END
              AND target.scope_type = src.scope_type
              AND COALESCE(target.campaign_id, '${ZERO_CAMPAIGN}'::uuid) = COALESCE(src.campaign_id, '${ZERO_CAMPAIGN}'::uuid)
         )
    `);
    await queryRunner.query(`
      UPDATE role_grant
         SET role_code = CASE role_code WHEN 'CAMPAIGN_MANAGER' THEN 'COORDINATOR' ELSE 'OPERATIONS_MANAGER' END
       WHERE role_code IN ('CAMPAIGN_MANAGER','INTAKE_STAFF')
    `);
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_role_code_check');
    await queryRunner.query(`ALTER TABLE role_grant ADD CONSTRAINT role_grant_role_code_check CHECK (role_code IN (${NEW_ROLE_CODES}))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_role_code_check');
    await queryRunner.query(`ALTER TABLE role_grant ADD CONSTRAINT role_grant_role_code_check CHECK (role_code IN (${OLD_ROLE_CODES}))`);
  }
}
