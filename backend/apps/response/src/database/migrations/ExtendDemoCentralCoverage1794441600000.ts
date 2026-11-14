import { MigrationInterface, QueryRunner } from 'typeorm';

// Historical migration kept for migration history. Region coverage was removed by
// RemoveRegionCoverage1794700800000, so this step no longer writes anything.
export class ExtendDemoCentralCoverage1794441600000 implements MigrationInterface {
  async up(_queryRunner: QueryRunner): Promise<void> {}

  async down(_queryRunner: QueryRunner): Promise<void> {}
}
