import { MigrationInterface, QueryRunner } from 'typeorm';

// Region is removed from the authorization scope model. Existing REGION grants become
// ORGANIZATION grants. Live grants that would collide after the conversion are revoked
// (the earliest live grant per user, role and organization is kept).
export class RemoveRegionScope1794700800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE role_grant r SET revoked_at = now()
       WHERE r.scope_type = 'REGION' AND r.revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM role_grant o
                      WHERE o.user_id = r.user_id AND o.role_code = r.role_code
                        AND o.scope_type = 'ORGANIZATION' AND o.organization_id = r.organization_id
                        AND o.revoked_at IS NULL)
    `);
    await queryRunner.query(`
      UPDATE role_grant r SET revoked_at = now()
        FROM (SELECT id, row_number() OVER (PARTITION BY user_id, role_code, organization_id ORDER BY created_at, id) AS rn
                FROM role_grant WHERE scope_type = 'REGION' AND revoked_at IS NULL) d
       WHERE r.id = d.id AND d.rn > 1
    `);
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS scope_shape');
    await queryRunner.query('ALTER TABLE role_grant DROP CONSTRAINT IF EXISTS role_grant_scope_type_check');
    await queryRunner.query('DROP INDEX IF EXISTS role_grant_live_uq');
    await queryRunner.query("UPDATE role_grant SET scope_type = 'ORGANIZATION' WHERE scope_type = 'REGION'");
    await queryRunner.query('ALTER TABLE role_grant DROP COLUMN IF EXISTS region_code');
    await queryRunner.query("ALTER TABLE role_grant ADD CONSTRAINT role_grant_scope_type_check CHECK (scope_type IN ('SYSTEM','ORGANIZATION','CAMPAIGN'))");
    await queryRunner.query(`
      ALTER TABLE role_grant ADD CONSTRAINT scope_shape CHECK (
        (scope_type = 'SYSTEM'       AND organization_id IS NULL AND campaign_id IS NULL) OR
        (scope_type = 'ORGANIZATION' AND organization_id IS NOT NULL AND campaign_id IS NULL) OR
        (scope_type = 'CAMPAIGN'     AND organization_id IS NOT NULL AND campaign_id IS NOT NULL))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX role_grant_live_uq ON role_grant (
        user_id, role_code, scope_type,
        COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) WHERE revoked_at IS NULL
    `);
    await queryRunner.query('DROP TABLE IF EXISTS region');
  }

  // Irreversible: region codes and the original REGION grant scopes are not retained.
  async down(): Promise<void> {
    throw new Error('RemoveRegionScope1794700800000 cannot be reverted: region data is not retained');
  }
}
