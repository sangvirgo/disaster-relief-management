import { MigrationInterface, QueryRunner } from 'typeorm';

// Need extraction sweep (SOS relief text -> ESTIMATED need lines).
//
// need_extraction_log has one row per (request, work cycle) that the sweep has decided about. The primary key makes a
// request processed at most once: CREATED (lines written), NO_LINES (every matching norm is inactive or the quantities
// round to zero), SKIPPED (the cycle already has a need line, or the SOS has no people count) or FAILED (a stable
// AppError code; not retried automatically, an operator deletes the row to reprocess).
//
// need_extraction_daily_usage counts Gemini calls made by this service per Pacific day. Response keeps its own counter in
// its own database, so the two counters are independent. GEMINI_DAILY_CALL_LIMIT keeps its existing meaning (0 = no cap).
export class AddNeedExtractionLog1795910400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE need_extraction_log (
      request_id uuid NOT NULL,
      work_cycle integer NOT NULL CHECK (work_cycle >= 1),
      status text NOT NULL CHECK (status IN ('CREATED','NO_LINES','SKIPPED','FAILED')),
      source text NULL CHECK (source IS NULL OR source IN ('GEMINI','ALIAS','DEFAULT_BUNDLE')),
      line_count integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
      error_code text NULL,
      processed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (request_id, work_cycle)
    )`);
    await queryRunner.query(`CREATE TABLE need_extraction_daily_usage (
      usage_date date PRIMARY KEY,
      calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Tables created by migrations do not inherit the application grants from the baseline schema, so grant them here.
    // Guarded so databases without the application role (for example a migration-only check) still migrate.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE ON need_extraction_log TO c48_logistics_app;
        GRANT SELECT, INSERT, UPDATE ON need_extraction_daily_usage TO c48_logistics_app;
      END IF;
    END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS need_extraction_daily_usage');
    await queryRunner.query('DROP TABLE IF EXISTS need_extraction_log');
  }
}
