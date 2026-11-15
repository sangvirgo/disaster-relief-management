import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeAiCallBudgetConfigurable1795000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE ai_daily_usage DROP CONSTRAINT ai_daily_usage_calls_check');
    await queryRunner.query('ALTER TABLE ai_daily_usage ADD CONSTRAINT ai_daily_usage_calls_check CHECK (calls >= 0)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE ai_daily_usage DROP CONSTRAINT ai_daily_usage_calls_check');
    await queryRunner.query('ALTER TABLE ai_daily_usage ADD CONSTRAINT ai_daily_usage_calls_check CHECK (calls BETWEEN 0 AND 500)');
  }
}
