import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNationwideTeamCoverage1794528000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE rescue_team ADD COLUMN nationwide_coverage boolean NOT NULL DEFAULT false");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE rescue_team DROP COLUMN nationwide_coverage');
  }
}
