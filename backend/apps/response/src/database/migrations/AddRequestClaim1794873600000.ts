import { MigrationInterface, QueryRunner } from 'typeorm';

// Soft "nhận xử lý" claim on an assistance request. The holder and the last coordination activity time;
// a claim older than 15 minutes is treated as released by the application (see CLAIM_TTL_MINUTES).
export class AddRequestClaim1794873600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE assistance_request ADD COLUMN handled_by uuid');
    await queryRunner.query('ALTER TABLE assistance_request ADD COLUMN handled_at timestamptz');
    await queryRunner.query(`
      ALTER TABLE assistance_request ADD CONSTRAINT assistance_request_handled_pair_check
        CHECK ((handled_by IS NULL) = (handled_at IS NULL))
    `);
    await queryRunner.query(`
      CREATE INDEX request_handled_by_idx ON assistance_request (handled_by, handled_at)
       WHERE handled_by IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS request_handled_by_idx');
    await queryRunner.query('ALTER TABLE assistance_request DROP CONSTRAINT IF EXISTS assistance_request_handled_pair_check');
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN IF EXISTS handled_at');
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN IF EXISTS handled_by');
  }
}
