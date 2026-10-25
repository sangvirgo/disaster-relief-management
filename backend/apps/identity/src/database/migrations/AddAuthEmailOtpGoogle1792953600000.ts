import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthEmailOtpGoogle1792953600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email text');
    await queryRunner.query('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email_verified_at timestamptz');
    await queryRunner.query('ALTER TABLE app_user ALTER COLUMN password_hash DROP NOT NULL');
    await queryRunner.query('ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_status_check');
    await queryRunner.query("ALTER TABLE app_user ADD CONSTRAINT app_user_status_check CHECK (status IN ('PENDING_EMAIL','ACTIVE','DISABLED')) NOT VALID");
    await queryRunner.query('ALTER TABLE app_user VALIDATE CONSTRAINT app_user_status_check');
    await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_lower_uq ON app_user (lower(email)) WHERE email IS NOT NULL');
    await queryRunner.query("CREATE INDEX IF NOT EXISTS app_user_pending_email_idx ON app_user (created_at) WHERE status='PENDING_EMAIL'");
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS external_identity (
        provider text NOT NULL CHECK (provider IN ('GOOGLE')),
        subject text NOT NULL CHECK (btrim(subject) <> ''),
        user_id uuid NOT NULL REFERENCES app_user(id),
        email_at_link text,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, subject), UNIQUE (user_id, provider)
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS external_identity_user_idx ON external_identity (user_id)');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS email_verification_challenge (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES app_user(id),
        email text NOT NULL,
        code_hash text NOT NULL,
        attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        CONSTRAINT email_challenge_expiry CHECK (expires_at > created_at),
        CONSTRAINT email_challenge_consumed CHECK (consumed_at IS NULL OR consumed_at >= created_at)
      )`);
    await queryRunner.query("CREATE INDEX IF NOT EXISTS email_challenge_user_live_idx ON email_verification_challenge (user_id, created_at DESC) WHERE consumed_at IS NULL");
    await queryRunner.query("CREATE INDEX IF NOT EXISTS email_challenge_expiry_idx ON email_verification_challenge (expires_at) WHERE consumed_at IS NULL");
    await queryRunner.query('GRANT INSERT, UPDATE ON email_verification_challenge TO c48_identity_app');
    await queryRunner.query('GRANT INSERT ON external_identity TO c48_identity_app');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM app_user WHERE email IS NOT NULL OR status='PENDING_EMAIL' OR password_hash IS NULL)
          OR EXISTS (SELECT 1 FROM external_identity)
          OR EXISTS (SELECT 1 FROM email_verification_challenge) AS has_data`);
    if (rows[0]?.has_data) throw new Error('Cannot roll back Identity email/Google migration while account data would be lost');
    await queryRunner.query('DROP TABLE IF EXISTS email_verification_challenge');
    await queryRunner.query('DROP TABLE IF EXISTS external_identity');
    await queryRunner.query('DROP INDEX IF EXISTS app_user_pending_email_idx');
    await queryRunner.query('DROP INDEX IF EXISTS app_user_email_lower_uq');
    await queryRunner.query('ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_status_check');
    await queryRunner.query("ALTER TABLE app_user ADD CONSTRAINT app_user_status_check CHECK (status IN ('ACTIVE','DISABLED'))");
    await queryRunner.query('ALTER TABLE app_user ALTER COLUMN password_hash SET NOT NULL');
    await queryRunner.query('ALTER TABLE app_user DROP COLUMN IF EXISTS email_verified_at');
    await queryRunner.query('ALTER TABLE app_user DROP COLUMN IF EXISTS email');
  }
}
