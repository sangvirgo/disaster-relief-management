import { MigrationInterface, QueryRunner } from 'typeorm';
import { applySchema, dropSchema } from '@c48/technical';

export class InitialResponse1710000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await applySchema(queryRunner, 'response', 'response-initial.sql');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await dropSchema(queryRunner);
  }
}
