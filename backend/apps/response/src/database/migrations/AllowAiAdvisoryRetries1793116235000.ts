import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowAiAdvisoryRetries1793116235000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE ai_advisory DROP CONSTRAINT IF EXISTS ai_advisory_attempts_check');
    await queryRunner.query('ALTER TABLE ai_advisory ADD CONSTRAINT ai_advisory_attempts_check CHECK (attempts BETWEEN 0 AND 3)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('UPDATE ai_advisory SET attempts=1 WHERE attempts>1');
    await queryRunner.query('ALTER TABLE ai_advisory DROP CONSTRAINT IF EXISTS ai_advisory_attempts_check');
    await queryRunner.query('ALTER TABLE ai_advisory ADD CONSTRAINT ai_advisory_attempts_check CHECK (attempts BETWEEN 0 AND 1)');
  }
}
