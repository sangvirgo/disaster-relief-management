import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantExternalIdentitySelect1794144543000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('GRANT SELECT, INSERT ON external_identity TO c48_identity_app');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('REVOKE SELECT ON external_identity FROM c48_identity_app');
  }
}
