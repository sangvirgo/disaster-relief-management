import { MigrationInterface, QueryRunner } from 'typeorm';

/** Catalog managers may delete only unreferenced items; foreign keys preserve business history. */
export class AllowUnusedItemDeletion1796083200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT DELETE ON item TO c48_logistics_app;
      END IF;
    END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        REVOKE DELETE ON item FROM c48_logistics_app;
      END IF;
    END $$`);
  }
}
