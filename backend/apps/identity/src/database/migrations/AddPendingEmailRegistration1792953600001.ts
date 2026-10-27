import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingEmailRegistration1792953600001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`-- Ephemeral signup attempts are not accounts and never reserve account identifiers.
CREATE TABLE IF NOT EXISTS email_registration (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- prospective app_user id, no FK
  challenge_id    uuid NOT NULL UNIQUE,
  username        citext NOT NULL CHECK (username::text ~ '^[A-Za-z0-9._-]{3,64}$'),
  display_name    text NOT NULL CHECK (is_clean_text(display_name)),
  email           text NOT NULL,
  password_hash   text,
  code_hash       text,
  attempts        int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  code_expires_at timestamptz NOT NULL,
  last_sent_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  CONSTRAINT email_registration_lifetime CHECK (expires_at = created_at + interval '10 minutes'),
  CONSTRAINT email_registration_code_expiry CHECK (code_expires_at > created_at AND code_expires_at <= expires_at),
  CONSTRAINT email_registration_confirmation CHECK (
    (confirmed_at IS NULL AND password_hash IS NOT NULL AND code_hash IS NOT NULL) OR
    (confirmed_at IS NOT NULL AND confirmed_at >= created_at AND password_hash IS NULL AND code_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS email_registration_expiry_idx ON email_registration (expires_at,id); -- bounded cleanup, including confirmed attempts

`);
    await queryRunner.query('GRANT SELECT, INSERT, UPDATE, DELETE ON email_registration TO c48_identity_app');
    await queryRunner.query('REVOKE INSERT, UPDATE ON email_verification_challenge FROM c48_identity_app');
    // Repair only the old OTP activation path with no grant history; never reinstate revoked grants.
    await queryRunner.query(`INSERT INTO role_grant (user_id,role_code,scope_type)
      SELECT u.id,'CITIZEN','SYSTEM' FROM app_user u
      WHERE u.status='ACTIVE' AND u.email_verified_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM role_grant g WHERE g.user_id=u.id)
        AND EXISTS (SELECT 1 FROM email_verification_challenge c
          WHERE c.user_id=u.id AND lower(c.email)=lower(u.email)
            AND c.consumed_at=u.email_verified_at)
      ON CONFLICT DO NOTHING`);
    // Only unused legacy placeholders are safe to anonymize. Preserve their UUIDs and history.
    await queryRunner.query(`
      WITH candidates AS MATERIALIZED (
        SELECT u.* FROM app_user u
        WHERE u.status='PENDING_EMAIL' AND u.email_verified_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM session_family s WHERE s.user_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM role_grant g WHERE g.user_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.user_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM external_identity e WHERE e.user_id=u.id)
        FOR UPDATE OF u
      ), migrated AS (
        INSERT INTO email_registration
          (id,challenge_id,username,display_name,email,password_hash,code_hash,attempts,created_at,expires_at,code_expires_at,last_sent_at)
        SELECT gen_random_uuid(),c.id,u.username,u.display_name,u.email,u.password_hash,c.code_hash,c.attempts,
               u.created_at,u.created_at+interval '10 minutes',
               LEAST(c.expires_at,u.created_at+interval '10 minutes'),c.created_at
        FROM candidates u JOIN LATERAL (
          SELECT c.* FROM email_verification_challenge c WHERE c.user_id=u.id
          ORDER BY c.created_at DESC,c.id DESC LIMIT 1
        ) c ON true
        WHERE u.email IS NOT NULL AND u.password_hash IS NOT NULL
          AND u.created_at+interval '10 minutes'>now() AND c.expires_at>now() AND c.consumed_at IS NULL
        ON CONFLICT (challenge_id) DO NOTHING RETURNING id
      )
      UPDATE app_user SET username='expired_'||replace(id::text,'-',''),display_name='Đăng ký đã hết hạn',
             email=NULL,password_hash=NULL,status='DISABLED',authz_version=authz_version+1,version=version+1
      WHERE id IN (SELECT id FROM candidates)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(`SELECT
      EXISTS (SELECT 1 FROM email_registration)
      OR EXISTS (SELECT 1 FROM app_user WHERE username::text='expired_'||replace(id::text,'-','')) AS has_state`);
    // Account anonymization is irreversible; only an empty, unconverted installation can roll back.
    if (rows[0]?.has_state !== false) {
      throw new Error('Cannot automatically roll back the pending-registration migration; restore a reviewed backup');
    }
    await queryRunner.query('DROP TABLE email_registration');
    await queryRunner.query('GRANT INSERT, UPDATE ON email_verification_challenge TO c48_identity_app');
  }
}
