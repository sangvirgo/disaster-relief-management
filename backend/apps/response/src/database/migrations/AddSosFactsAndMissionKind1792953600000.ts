import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSosFactsAndMissionKind1792953600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE assistance_request ADD COLUMN IF NOT EXISTS needs_rescue boolean NOT NULL DEFAULT true');
    await queryRunner.query('ALTER TABLE assistance_request ADD COLUMN IF NOT EXISTS needs_relief_supplies boolean NOT NULL DEFAULT false');
    await queryRunner.query('ALTER TABLE assistance_request DROP CONSTRAINT IF EXISTS request_has_need');
    await queryRunner.query('ALTER TABLE assistance_request ADD CONSTRAINT request_has_need CHECK (needs_rescue OR needs_relief_supplies) NOT VALID');
    await queryRunner.query('ALTER TABLE assistance_request VALIDATE CONSTRAINT request_has_need');
    await queryRunner.query('ALTER TABLE request_subject ADD COLUMN IF NOT EXISTS children_count int CHECK (children_count BETWEEN 0 AND 10000)');
    await queryRunner.query('ALTER TABLE request_subject ADD COLUMN IF NOT EXISTS elderly_count int CHECK (elderly_count BETWEEN 0 AND 10000)');
    await queryRunner.query('ALTER TABLE request_subject DROP CONSTRAINT IF EXISTS vulnerable_count_within_total');
    await queryRunner.query('ALTER TABLE request_subject ADD CONSTRAINT vulnerable_count_within_total CHECK (people_affected IS NULL OR coalesce(children_count,0) + coalesce(elderly_count,0) <= people_affected) NOT VALID');
    await queryRunner.query('ALTER TABLE request_subject VALIDATE CONSTRAINT vulnerable_count_within_total');
    await queryRunner.query("ALTER TABLE mission ADD COLUMN IF NOT EXISTS mission_kind text NOT NULL DEFAULT 'RESCUE' CHECK (mission_kind IN ('RESCUE','DELIVERY','COMBINED'))");
    await queryRunner.query('ALTER TABLE mission ADD COLUMN IF NOT EXISTS distribution_id uuid');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS mission_request_history_idx ON mission (request_id, created_at DESC, id DESC)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM assistance_request WHERE needs_rescue IS DISTINCT FROM true OR needs_relief_supplies IS DISTINCT FROM false)
          OR EXISTS (SELECT 1 FROM request_subject WHERE children_count IS NOT NULL OR elderly_count IS NOT NULL)
          OR EXISTS (SELECT 1 FROM mission WHERE mission_kind IS DISTINCT FROM 'RESCUE' OR distribution_id IS NOT NULL) AS has_data`);
    if (rows[0]?.has_data) throw new Error('Cannot roll back SOS facts while non-default facts or non-RESCUE missions exist');
    await queryRunner.query('DROP INDEX IF EXISTS mission_request_history_idx');
    await queryRunner.query('ALTER TABLE mission DROP COLUMN IF EXISTS distribution_id');
    await queryRunner.query('ALTER TABLE mission DROP COLUMN IF EXISTS mission_kind');
    await queryRunner.query('ALTER TABLE request_subject DROP CONSTRAINT IF EXISTS vulnerable_count_within_total');
    await queryRunner.query('ALTER TABLE request_subject DROP COLUMN IF EXISTS elderly_count');
    await queryRunner.query('ALTER TABLE request_subject DROP COLUMN IF EXISTS children_count');
    await queryRunner.query('ALTER TABLE assistance_request DROP CONSTRAINT IF EXISTS request_has_need');
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN IF EXISTS needs_relief_supplies');
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN IF EXISTS needs_rescue');
  }
}
