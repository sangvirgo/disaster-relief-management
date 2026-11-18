import { MigrationInterface, QueryRunner } from 'typeorm';

const ROLE_CODES_WITHOUT = `'CITIZEN','VOLUNTEER','COORDINATOR','OPERATIONS_MANAGER','REVIEWER','ADMIN'`;
const ROLE_CODES_WITH = `'CITIZEN','VOLUNTEER','COORDINATOR','CAMPAIGN_COORDINATOR','OPERATIONS_MANAGER','REVIEWER','ADMIN'`;

/**
 * Retires CAMPAIGN_COORDINATOR. Its grants are deleted (not remapped): the role was a narrower, engagement-gated
 * coordinator, so mapping it to COORDINATOR would widen access. Holders must be re-granted COORDINATOR explicitly.
 * Rollback restores the role catalog only; deleted grants are not restored.
 */
export class RetireCampaignCoordinatorRole1795132800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE app_user SET authz_version = authz_version + 1, version = version + 1
       WHERE id IN (SELECT user_id FROM role_grant WHERE role_code = 'CAMPAIGN_COORDINATOR')
    `);
    await queryRunner.query(`DELETE FROM role_grant WHERE role_code = 'CAMPAIGN_COORDINATOR'`);
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_role_code_check');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_scope');
    await queryRunner.query(`ALTER TABLE role_grant ADD CONSTRAINT role_grant_role_code_check CHECK (role_code IN (${ROLE_CODES_WITHOUT}))`);
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT role_scope CHECK (
        (role_code IN ('ADMIN','CITIZEN','VOLUNTEER') AND scope_type = 'SYSTEM') OR
        (role_code NOT IN ('ADMIN','CITIZEN','VOLUNTEER') AND scope_type IN ('SYSTEM','CAMPAIGN'))
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_role_code_check');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_scope');
    await queryRunner.query(`ALTER TABLE role_grant ADD CONSTRAINT role_grant_role_code_check CHECK (role_code IN (${ROLE_CODES_WITH}))`);
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT role_scope CHECK (
        (role_code = 'ADMIN' AND scope_type = 'SYSTEM') OR
        (role_code IN ('CITIZEN','VOLUNTEER','CAMPAIGN_COORDINATOR') AND scope_type = 'SYSTEM') OR
        (role_code NOT IN ('ADMIN','CITIZEN','VOLUNTEER','CAMPAIGN_COORDINATOR') AND scope_type IN ('SYSTEM','CAMPAIGN'))
      )
    `);
  }
}
