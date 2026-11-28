import { MigrationInterface, QueryRunner } from 'typeorm';

// The readiness latch is removed (user decision 2026-11-28): a cancelled or cut-short mission no longer locks the team
// until someone confirms it is ready. Teams that are latched now are released to AVAILABLE, then the column is dropped.
export class RemoveTeamReadinessLatch1795990000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const column = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='rescue_team' AND column_name='readiness_required'`,
    ) as unknown[];
    if (!column.length) return;
    await queryRunner.query(`UPDATE rescue_team SET availability='AVAILABLE',version=version+1
      WHERE readiness_required AND status='ACTIVE' AND availability='UNAVAILABLE'`);
    await queryRunner.query('ALTER TABLE rescue_team DROP COLUMN readiness_required');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE rescue_team ADD COLUMN IF NOT EXISTS readiness_required boolean NOT NULL DEFAULT false');
  }
}
