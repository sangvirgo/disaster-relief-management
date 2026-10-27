import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowAiAdvisoryRetryAttempts1793117000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE ai_advisory DROP CONSTRAINT IF EXISTS ai_advisory_attempts_check');
    await queryRunner.query('ALTER TABLE ai_advisory ADD CONSTRAINT ai_advisory_attempts_check CHECK (attempts >= 0)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('UPDATE ai_advisory SET attempts=3 WHERE attempts>3');
    await queryRunner.query('ALTER TABLE ai_advisory DROP CONSTRAINT IF EXISTS ai_advisory_attempts_check');
    await queryRunner.query('ALTER TABLE ai_advisory ADD CONSTRAINT ai_advisory_attempts_check CHECK (attempts BETWEEN 0 AND 3)');
  }
}
