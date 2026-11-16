import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import { RetireLegacyStaffRoles1795046400000 } from '../src/database/migrations/RetireLegacyStaffRoles1795046400000';
import { CreateGrantDto } from '../src/grants/grants.dto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

describe('RetireLegacyStaffRoles migration', () => {
  it('deletes distribution staff grants and remaps the other retired roles with collision handling', async () => {
    const query = jest.fn(async () => undefined);
    await new RetireLegacyStaffRoles1795046400000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("DELETE FROM role_grant WHERE role_code = 'DISTRIBUTION_STAFF'"))).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE role_grant src SET revoked_at = now()'))).toBe(true);
    expect(statements.some((sql) => sql.includes("WHEN 'CAMPAIGN_MANAGER' THEN 'COORDINATOR' ELSE 'OPERATIONS_MANAGER'"))).toBe(true);
    expect(statements.some((sql) => sql.includes('authz_version = authz_version + 1'))).toBe(true);
    const check = statements.at(-1)!;
    expect(check).toContain("'OPERATIONS_MANAGER','REVIEWER','ADMIN'");
    expect(check).not.toContain('CAMPAIGN_MANAGER');
    expect(check).not.toContain('INTAKE_STAFF');
    expect(check).not.toContain('DISTRIBUTION_STAFF');
  });

  it('restores the previous role catalog on rollback without restoring retired grants', async () => {
    const query = jest.fn(async () => undefined);
    await new RetireLegacyStaffRoles1795046400000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain("'CAMPAIGN_MANAGER'");
    expect(statements[1]).toContain("'DISTRIBUTION_STAFF'");
  });
});

describe('CreateGrantDto role catalog', () => {
  const base = { scope_type: 'SYSTEM', reason: 'Phân công vận hành' };
  it.each(['CAMPAIGN_MANAGER', 'INTAKE_STAFF', 'DISTRIBUTION_STAFF'])('rejects retired role %s', (role) => {
    const errors = validateSync(plainToInstance(CreateGrantDto, { ...base, role_code: role }));
    expect(errors.some((error) => error.property === 'role_code')).toBe(true);
  });

  it('accepts OPERATIONS_MANAGER with a campaign scope', () => {
    const errors = validateSync(plainToInstance(CreateGrantDto, {
      role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: '99999999-9999-4999-8999-999999999999', reason: 'Phân công vận hành',
    }));
    expect(errors).toHaveLength(0);
  });
});
