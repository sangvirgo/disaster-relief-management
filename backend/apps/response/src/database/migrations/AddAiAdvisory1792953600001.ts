import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiAdvisory1792953600001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_advisory (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NOT NULL REFERENCES assistance_request(id),
        request_version int NOT NULL,
        input_hash text NOT NULL,
        model text NOT NULL,
        prompt_version text NOT NULL,
        schema_version text NOT NULL,
        status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','FAILED','SKIPPED')),
        attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1),
        lease_until timestamptz,
        extracted_json jsonb,
        risk_score int CHECK (risk_score BETWEEN 0 AND 100),
        reason_codes text[] NOT NULL DEFAULT '{}',
        review_status text CHECK (review_status IN ('ACCEPTED','ADJUSTED','REJECTED')),
        review_by_user_id uuid,
        review_at timestamptz,
        review_note text,
        error_code text CHECK (error_code IS NULL OR error_code IN ('AI_DISABLED','AI_DAILY_LIMIT','AI_PROVIDER_ERROR','AI_INVALID_OUTPUT')),
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (request_id, input_hash),
        CONSTRAINT ai_review_pair CHECK ((review_status IS NULL) = (review_at IS NULL) AND (review_at IS NULL) = (review_by_user_id IS NULL))
      )`);
    await queryRunner.query("CREATE INDEX IF NOT EXISTS ai_advisory_queue_idx ON ai_advisory (created_at, id) WHERE status IN ('QUEUED','PROCESSING')");
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ai_advisory_request_idx ON ai_advisory (request_id, created_at DESC, id DESC)');
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ai_daily_usage (
      usage_date date PRIMARY KEY,
      calls int NOT NULL CHECK (calls BETWEEN 0 AND 500),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('GRANT INSERT, UPDATE ON ai_advisory, ai_daily_usage TO c48_response_app');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query('SELECT EXISTS (SELECT 1 FROM ai_advisory) OR EXISTS (SELECT 1 FROM ai_daily_usage) AS has_data');
    if (rows[0]?.has_data) throw new Error('Cannot roll back AI advisory migration while AI advisory or usage history exists');
    await queryRunner.query('DROP TABLE IF EXISTS ai_daily_usage');
    await queryRunner.query('DROP TABLE IF EXISTS ai_advisory');
  }
}
