import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEvidenceUploadIpQuota1710000000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE evidence_metadata ADD COLUMN upload_source_ip_hash text');
    await queryRunner.query('ALTER TABLE evidence_metadata ADD COLUMN cleanup_completed_at timestamptz');
    await queryRunner.query(
      'CREATE INDEX evidence_upload_ip_created_idx ON evidence_metadata (upload_source_ip_hash, created_at) WHERE upload_source_ip_hash IS NOT NULL',
    );
    await queryRunner.query(
      "CREATE INDEX evidence_cleanup_pending_idx ON evidence_metadata (created_at) WHERE state='FAILED' AND cleanup_completed_at IS NULL",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS evidence_cleanup_pending_idx');
    await queryRunner.query('DROP INDEX IF EXISTS evidence_upload_ip_created_idx');
    await queryRunner.query('ALTER TABLE evidence_metadata DROP COLUMN IF EXISTS cleanup_completed_at');
    await queryRunner.query('ALTER TABLE evidence_metadata DROP COLUMN IF EXISTS upload_source_ip_hash');
  }
}
