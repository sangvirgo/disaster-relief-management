import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { AddPendingEmailRegistration1792953600001 } from '../src/database/migrations/AddPendingEmailRegistration1792953600001';

// Read-only checks on migration safety boundaries. Database execution remains an acceptance gate.
describe('pending registration migration safeguards', () => {
  it('releases only unused unverified placeholders and preserves opaque account history', async () => {
    const query = jest.fn(async (_sql: string) => []);
    await new AddPendingEmailRegistration1792953600001().up({ query } as never);
    const transfer = query.mock.calls.find(([sql]) => sql.includes('WITH candidates'))![0];
    expect(transfer).toContain("u.status='PENDING_EMAIL' AND u.email_verified_at IS NULL");
    for (const table of ['session_family', 'role_grant', 'membership', 'external_identity']) {
      expect(transfer).toMatch(new RegExp(`NOT EXISTS \\(SELECT 1 FROM ${table} [a-z] WHERE [a-z].user_id=u.id\\)`));
    }
    expect(transfer).toContain('FOR UPDATE OF u');
    expect(transfer).toContain("u.created_at+interval '10 minutes'");
    expect(transfer).toContain('gen_random_uuid(),c.id');
    expect(transfer).toContain("email=NULL,password_hash=NULL,status='DISABLED'");
    expect(transfer).toContain('WHERE id IN (SELECT id FROM candidates)');
    expect(transfer).not.toMatch(/DELETE FROM|DROP TABLE/u);
    const grants = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO role_grant'))![0];
    expect(grants).toContain("u.status='ACTIVE' AND u.email_verified_at IS NOT NULL");
    expect(grants).toContain('NOT EXISTS (SELECT 1 FROM role_grant g WHERE g.user_id=u.id)');
    expect(grants).toContain('c.consumed_at=u.email_verified_at');
    expect(grants).toContain('lower(c.email)=lower(u.email)');
  });

  it('matches canonical ephemeral constraints and grants deletion only on the new table', async () => {
    const query = jest.fn(async (_sql: string) => []);
    await new AddPendingEmailRegistration1792953600001().up({ query } as never);
    const ddl = query.mock.calls[0]![0];
    const canonical = readFileSync('../docs/backend/schema/identity.sql', 'utf8');
    for (const sql of [ddl, canonical]) {
      expect(sql).toContain("expires_at = created_at + interval '10 minutes'");
      expect(sql).toContain('code_expires_at <= expires_at');
      expect(sql).toContain('password_hash IS NULL AND code_hash IS NULL');
      expect(sql).not.toMatch(/UNIQUE\s*\(\s*(?:email|username)\s*\)/u);
    }
    const access = query.mock.calls.filter(([sql]) => /GRANT|REVOKE/u.test(sql)).map(([sql]) => sql);
    expect(access).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON email_registration TO c48_identity_app');
    expect(access).toContain('REVOKE INSERT, UPDATE ON email_verification_challenge FROM c48_identity_app');
    expect(access.filter((sql) => sql.includes('DELETE'))).toHaveLength(1);

  });
  it('rolls back an empty installation without converted legacy placeholders', async () => {
    const query = jest.fn(async (_sql: string) => [{ has_state: false }]);
    await expect(new AddPendingEmailRegistration1792953600001().down({ query } as never)).resolves.toBeUndefined();
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
      'DROP TABLE email_registration',
      'GRANT INSERT, UPDATE ON email_verification_challenge TO c48_identity_app',
    ]));
  });

  it('refuses rollback when pending data or anonymized legacy placeholders exist', async () => {
    const query = jest.fn(async (_sql: string) => [{ has_state: true }]);
    await expect(new AddPendingEmailRegistration1792953600001().down({ query } as never)).rejects.toThrow('Cannot automatically roll back');
    const stateCheck = query.mock.calls[0]![0];
    expect(stateCheck).toContain('EXISTS (SELECT 1 FROM email_registration)');
    expect(stateCheck).toContain("username::text='expired_'||replace(id::text,'-','')");
    expect(query).toHaveBeenCalledTimes(1);
  });

});
