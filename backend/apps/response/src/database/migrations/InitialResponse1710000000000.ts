import { MigrationInterface, QueryRunner } from 'typeorm';
import { applySchema, dropSchema } from '../../../../../packages/technical/src';

export class InitialResponse1710000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await applySchema(queryRunner, 'response');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await dropSchema(queryRunner);
  }
}
