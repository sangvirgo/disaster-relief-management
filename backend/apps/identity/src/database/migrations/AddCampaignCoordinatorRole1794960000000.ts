import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignCoordinatorRole1794960000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS role_grant_live_uq');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_role_code_check');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_scope');
    await queryRunner.query(`
      UPDATE role_grant old
         SET revoked_at = COALESCE(old.revoked_at, now())
       WHERE old.role_code = 'COORDINATOR' AND old.scope_type = 'CAMPAIGN' AND old.revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM role_grant current
            WHERE current.user_id = old.user_id AND current.role_code = 'CAMPAIGN_COORDINATOR'
              AND current.scope_type = 'SYSTEM' AND current.campaign_id IS NULL AND current.revoked_at IS NULL
         )
    `);
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS position
          FROM role_grant
         WHERE role_code='COORDINATOR' AND scope_type='CAMPAIGN' AND revoked_at IS NULL
      )
      UPDATE role_grant old SET revoked_at=now()
        FROM ranked WHERE old.id=ranked.id AND ranked.position > 1
    `);
    await queryRunner.query(`
      UPDATE role_grant SET role_code='CAMPAIGN_COORDINATOR', scope_type='SYSTEM', campaign_id=NULL
       WHERE role_code='COORDINATOR' AND scope_type='CAMPAIGN'
    `);
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT role_grant_role_code_check CHECK (role_code IN (
        'CITIZEN','VOLUNTEER','COORDINATOR','CAMPAIGN_COORDINATOR','CAMPAIGN_MANAGER',
        'OPERATIONS_MANAGER','INTAKE_STAFF','REVIEWER','DISTRIBUTION_STAFF','ADMIN'
      ))
    `);
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT role_scope CHECK (
        (role_code = 'ADMIN' AND scope_type = 'SYSTEM') OR
        (role_code IN ('CITIZEN','VOLUNTEER','CAMPAIGN_COORDINATOR') AND scope_type = 'SYSTEM') OR
        (role_code NOT IN ('ADMIN','CITIZEN','VOLUNTEER','CAMPAIGN_COORDINATOR') AND scope_type IN ('SYSTEM','CAMPAIGN'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX role_grant_live_uq ON role_grant (
        user_id, role_code, scope_type,
        COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) WHERE revoked_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS role_grant_live_uq');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_scope');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_role_code_check');
    await queryRunner.query(`
      UPDATE role_grant old SET revoked_at=COALESCE(old.revoked_at,now())
       WHERE old.role_code='CAMPAIGN_COORDINATOR' AND old.scope_type='SYSTEM' AND old.revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM role_grant current
            WHERE current.user_id=old.user_id AND current.role_code='COORDINATOR'
              AND current.scope_type='SYSTEM' AND current.campaign_id IS NULL AND current.revoked_at IS NULL
         )
    `);
    await queryRunner.query(`
      UPDATE role_grant SET role_code='COORDINATOR'
       WHERE role_code='CAMPAIGN_COORDINATOR'
    `);
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT role_grant_role_code_check CHECK (role_code IN (
        'CITIZEN','VOLUNTEER','COORDINATOR','CAMPAIGN_MANAGER','OPERATIONS_MANAGER',
        'INTAKE_STAFF','REVIEWER','DISTRIBUTION_STAFF','ADMIN'
      ))
    `);
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT role_scope CHECK (
        (role_code IN ('CITIZEN','VOLUNTEER') AND scope_type = 'SYSTEM') OR
        (role_code NOT IN ('CITIZEN','VOLUNTEER') AND scope_type IN ('SYSTEM','CAMPAIGN'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX role_grant_live_uq ON role_grant (
        user_id, role_code, scope_type,
        COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) WHERE revoked_at IS NULL
    `);
  }
}
