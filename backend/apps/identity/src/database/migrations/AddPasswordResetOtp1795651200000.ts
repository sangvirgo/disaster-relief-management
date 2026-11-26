import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetOtp1795651200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE password_reset_challenge (
        challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES app_user(id),
        code_hash text,
        attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        CONSTRAINT password_reset_lifetime CHECK (expires_at = created_at + interval '5 minutes'),
        CONSTRAINT password_reset_consumption CHECK (
          (consumed_at IS NOT NULL AND consumed_at >= created_at AND code_hash IS NULL) OR
          (consumed_at IS NULL AND ((user_id IS NULL AND code_hash IS NULL) OR (user_id IS NOT NULL AND code_hash IS NOT NULL)))
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX password_reset_expiry_idx ON password_reset_challenge (expires_at, challenge_id)`);
    await queryRunner.query(`CREATE INDEX password_reset_user_live_idx ON password_reset_challenge (user_id, created_at DESC) WHERE consumed_at IS NULL`);
    await queryRunner.query(`
      CREATE TABLE identity_email_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        challenge_id uuid NOT NULL UNIQUE REFERENCES password_reset_challenge(challenge_id) ON DELETE CASCADE,
        encrypted_payload bytea NOT NULL,
        nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
        auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
        attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
        available_at timestamptz NOT NULL DEFAULT now(),
        locked_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX identity_email_outbox_pending_idx ON identity_email_outbox (available_at, id)`);
    await queryRunner.query('GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_challenge, identity_email_outbox TO c48_identity_app');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM password_reset_challenge)
          OR EXISTS (SELECT 1 FROM identity_email_outbox) AS has_data
    `);
    if (rows[0]?.has_data) throw new Error('Cannot roll back the password-reset migration while challenge or mail state exists');
    await queryRunner.query('DROP TABLE identity_email_outbox');
    await queryRunner.query('DROP TABLE password_reset_challenge');
  }
}
