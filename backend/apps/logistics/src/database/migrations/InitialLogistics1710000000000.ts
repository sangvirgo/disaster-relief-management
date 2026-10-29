import { MigrationInterface, QueryRunner } from 'typeorm';
import { applySchema, dropSchema } from '@c48/technical';

export class InitialLogistics1710000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await applySchema(queryRunner, 'logistics');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await dropSchema(queryRunner);
  }
}
