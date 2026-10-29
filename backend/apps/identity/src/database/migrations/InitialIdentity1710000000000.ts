import { MigrationInterface, QueryRunner } from 'typeorm';
import { applySchema, dropSchema } from '@c48/technical';

export class InitialIdentity1710000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await applySchema(queryRunner, 'identity');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await dropSchema(queryRunner);
  }
}
