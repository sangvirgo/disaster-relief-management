import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveOrganizationIdentity1794787200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS role_grant_live_uq');
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id, row_number() OVER (
          PARTITION BY user_id, role_code,
            CASE WHEN scope_type = 'ORGANIZATION' THEN 'SYSTEM' ELSE scope_type END,
            CASE WHEN scope_type = 'ORGANIZATION' THEN NULL ELSE campaign_id END
          ORDER BY CASE WHEN scope_type = 'SYSTEM' THEN 0 ELSE 1 END, created_at, id
        ) AS position
        FROM role_grant
        WHERE revoked_at IS NULL
      )
      DELETE FROM role_grant g USING ranked r WHERE g.id = r.id AND r.position > 1
    `);
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS scope_shape');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_scope');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_scope_type_check');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_organization_id_fkey');
    await queryRunner.query(`
      UPDATE role_grant SET scope_type = 'SYSTEM', campaign_id = NULL
       WHERE scope_type = 'ORGANIZATION'
    `);
    await queryRunner.query('UPDATE role_grant SET organization_id = NULL WHERE organization_id IS NOT NULL');
    await queryRunner.query('DROP INDEX IF EXISTS role_grant_org_idx');
    await queryRunner.query('DROP TABLE IF EXISTS membership');
    await queryRunner.query('DROP TABLE IF EXISTS organization');
    await queryRunner.query('ALTER TABLE role_grant DROP COLUMN organization_id');
    await queryRunner.query("ALTER TABLE role_grant ADD CONSTRAINT role_grant_scope_type_check CHECK (scope_type IN ('SYSTEM','CAMPAIGN'))");
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT scope_shape CHECK (
        (scope_type = 'SYSTEM' AND campaign_id IS NULL) OR
        (scope_type = 'CAMPAIGN' AND campaign_id IS NOT NULL))
    `);
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT role_scope CHECK (
        (role_code IN ('CITIZEN','VOLUNTEER') AND scope_type = 'SYSTEM') OR
        (role_code NOT IN ('CITIZEN','VOLUNTEER') AND scope_type IN ('SYSTEM','CAMPAIGN')))
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
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS scope_shape');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_scope');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_scope_type_check');
    await queryRunner.query(`
      CREATE TABLE organization (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL CHECK (is_clean_text(name)),
        organization_kind text NOT NULL CHECK (organization_kind IN ('COORDINATION','VOLUNTEER','MILITARY','GOVERNMENT','OTHER')),
        status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at timestamptz NOT NULL DEFAULT now(),
        version int NOT NULL DEFAULT 1
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX organization_name_uq ON organization (lower(name))');
    await queryRunner.query('CREATE INDEX organization_created_idx ON organization (created_at, id)');
    await queryRunner.query('ALTER TABLE role_grant ADD COLUMN organization_id uuid REFERENCES organization(id)');
    await queryRunner.query(`
      CREATE TABLE membership (
        user_id uuid NOT NULL REFERENCES app_user(id),
        organization_id uuid NOT NULL REFERENCES organization(id),
        status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        PRIMARY KEY (user_id, organization_id)
      )
    `);
    await queryRunner.query('CREATE INDEX membership_org_idx ON membership (organization_id) WHERE status = \'ACTIVE\'');
    await queryRunner.query("ALTER TABLE role_grant ADD CONSTRAINT role_grant_scope_type_check CHECK (scope_type IN ('SYSTEM','ORGANIZATION','CAMPAIGN'))");
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT scope_shape CHECK (
        (scope_type = 'SYSTEM' AND organization_id IS NULL AND campaign_id IS NULL) OR
        (scope_type = 'ORGANIZATION' AND organization_id IS NOT NULL AND campaign_id IS NULL) OR
        (scope_type = 'CAMPAIGN' AND campaign_id IS NOT NULL))
    `);
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT role_scope CHECK (
        (role_code = 'ADMIN' AND scope_type = 'SYSTEM') OR
        (role_code IN ('CITIZEN','VOLUNTEER') AND scope_type IN ('SYSTEM','ORGANIZATION')) OR
        (role_code NOT IN ('ADMIN','CITIZEN','VOLUNTEER') AND scope_type IN ('SYSTEM','ORGANIZATION','CAMPAIGN')))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX role_grant_live_uq ON role_grant (
        user_id, role_code, scope_type,
        COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) WHERE revoked_at IS NULL
    `);
    await queryRunner.query('CREATE INDEX role_grant_org_idx ON role_grant (organization_id) WHERE revoked_at IS NULL AND organization_id IS NOT NULL');
  }
}
