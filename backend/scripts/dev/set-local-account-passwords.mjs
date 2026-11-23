import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import argon2 from 'argon2';
import pg from 'pg';

const root = resolve(import.meta.dirname, '../../..');
const envPath = resolve(root, 'backend/.env');
const source = readFileSync(envPath, 'utf8');
const config = dotenv.parse(source);
const password = process.env.C48_ACCOUNT_PASSWORD;
if (!password || password.length < 12) throw new Error('C48_ACCOUNT_PASSWORD must be supplied');
if (config.NODE_ENV === 'production') throw new Error('Refusing to change production passwords');
const client = new pg.Client({
  host: '127.0.0.1',
  port: Number(config.POSTGRES_HOST_PORT || 55432),
  database: 'c48_identity',
  user: 'identity_migrator',
  password: config.IDENTITY_MIGRATOR_PASSWORD,
});
const hash = await argon2.hash(password, { type: argon2.argon2id });
try {
  await client.connect();
  await client.query('BEGIN');
  const users = await client.query('SELECT id, username, authz_version, version FROM app_user FOR UPDATE');
  const updated = await client.query(
    'UPDATE app_user SET password_hash=$1, must_change_password=false, authz_version=authz_version+1, version=version+1 RETURNING id',
    [hash],
  );
  const revoked = await client.query(
    "UPDATE session_family SET revoked_at=now(), revoke_reason='PASSWORD_RESET' WHERE revoked_at IS NULL",
  );
  for (const user of users.rows) {
    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, before_state, after_state, reason)
       VALUES ('LOCAL_PASSWORD_RESET', 'app_user', $1, $2, $3, 'User-requested local account password synchronization')`,
      [user.id, { authz_version: user.authz_version, version: user.version },
        { authz_version: user.authz_version + 1, version: user.version + 1 }],
    );
  }
  if (updated.rowCount !== users.rowCount) throw new Error('Not all accounts were updated');
  await client.query('COMMIT');
  const nextEnv = /^SEED_PASSWORD=/m.test(source)
    ? source.replace(/^SEED_PASSWORD=.*$/m, `SEED_PASSWORD=${password}`)
    : `${source.trimEnd()}\nSEED_PASSWORD=${password}\n`;
  writeFileSync(envPath, nextEnv, 'utf8');
  console.log(`Updated ${updated.rowCount} accounts and revoked ${revoked.rowCount} active sessions`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
