import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequestSourceIpIndex1710000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX request_source_ip_idx ON assistance_request (source_ip_hash, received_at DESC) WHERE source_ip_hash IS NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS request_source_ip_idx');
  }
}
