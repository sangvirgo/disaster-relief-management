import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantAiAdvisoryRead1792953600002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('GRANT SELECT ON ai_advisory, ai_daily_usage TO c48_response_app');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('REVOKE SELECT ON ai_advisory, ai_daily_usage FROM c48_response_app');
  }
}
