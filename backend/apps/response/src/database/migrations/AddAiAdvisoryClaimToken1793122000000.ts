import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiAdvisoryClaimToken1793122000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE ai_advisory ADD COLUMN IF NOT EXISTS claim_token uuid');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("UPDATE ai_advisory SET status='QUEUED',lease_until=NULL WHERE status='PROCESSING'");
    await queryRunner.query('ALTER TABLE ai_advisory DROP COLUMN IF EXISTS claim_token');
  }
}
