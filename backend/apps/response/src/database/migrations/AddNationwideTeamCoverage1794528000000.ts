import { MigrationInterface, QueryRunner } from 'typeorm';

// Historical migration kept for migration history. Nationwide team coverage was removed by
// RemoveRegionCoverage1794700800000, so this step no longer changes the schema.
export class AddNationwideTeamCoverage1794528000000 implements MigrationInterface {
  async up(_queryRunner: QueryRunner): Promise<void> {}

  async down(_queryRunner: QueryRunner): Promise<void> {}
}
