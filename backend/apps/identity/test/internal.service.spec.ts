import { describe, expect, it, jest } from '@jest/globals';
import { InternalService } from '../src/internal/internal.service';

describe('Volunteer candidate search', () => {
  it('filters active SYSTEM volunteer grants before pagination and scopes its cursor to that filter', async () => {
    const query = jest.fn(async (_sql: string, _values: unknown[]) => [
      { id: '00000000-0000-4000-8000-000000000002', username: 'hoa', display_name: 'Hoa', created_at: new Date('2026-11-28T00:00:00Z') },
      { id: '00000000-0000-4000-8000-000000000001', username: 'ha', display_name: 'Hà', created_at: new Date('2026-11-27T00:00:00Z') },
    ]);
    const service = Object.assign(Object.create(InternalService.prototype), { introspectionDataSource: { query } }) as InternalService;
    const page = await service.searchActiveUsers('ho', undefined, 1, 'VOLUNTEER');
    const sql = query.mock.calls[0]![0];
    expect(sql).toContain("g.role_code = 'VOLUNTEER'");
    expect(sql).toContain("g.scope_type = 'SYSTEM'");
    expect(sql).toContain('g.revoked_at IS NULL');
    expect(page.items).toHaveLength(1);
    expect(page.more).toBe(true);
    await expect(service.searchActiveUsers('ho', page.cursor, 1)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
  });
});

describe('Identity internal active user check service', () => {
  const userId = '00000000-0000-4000-8000-000000000001';

  it.each([
    [[], { active: false, reason: 'USER_NOT_FOUND' }],
    [[{ status: 'DISABLED' }], { active: false, reason: 'USER_INACTIVE' }],
    [[{ status: 'ACTIVE' }], { active: true }],
  ] as const)('checks only account existence and status', async (rows, expected) => {
    const query = jest.fn(async () => rows);
    const service = Object.assign(Object.create(InternalService.prototype), {
      introspectionDataSource: { query },
    }) as InternalService;
    const check = (service as unknown as Record<string, unknown>)['activeUserCheck'] as ((id: string) => Promise<unknown>) | undefined;

    expect(typeof check).toBe('function');
    await expect(check?.call(service, userId)).resolves.toEqual(expected);
    expect(query).toHaveBeenCalledWith('SELECT status FROM app_user WHERE id = $1', [userId]);
  });
});

describe('Identity internal session introspection service', () => {
  it('returns grant transport fields without database-only grant identifiers', async () => {
    const query = jest.fn(async () => [{
      user_id: '00000000-0000-4000-8000-000000000001',
      display_name: 'Điều phối viên',
      status: 'ACTIVE',
      user_authz_version: 1,
      family_authz_version: 1,
      revoked_at: null,
      absolute_expires_at: new Date(Date.now() + 60_000),
      grant_id: '00000000-0000-4000-8000-000000000002',
      role_code: 'COORDINATOR',
      scope_type: 'SYSTEM',
      campaign_id: null,
    }]);
    const service = Object.assign(Object.create(InternalService.prototype), {
      introspectionDataSource: { query },
    }) as InternalService;

    const result = await service.introspect({
      sid: '00000000-0000-4000-8000-000000000003',
      sub: '00000000-0000-4000-8000-000000000001',
    });
    expect(result).toMatchObject({
      active: true,
      grants: [{ role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: null }],
    });
    expect(result.grants).toEqual([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: null }]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('Identity internal request coordinator grants service', () => {
  it.each([
    [null],
    ['00000000-0000-4000-8000-000000000002'],
  ] as const)('returns only active grants valid for campaign %s', async (campaignId) => {
    const query = jest.fn(async (_sql: string, _values: unknown[]) => []);
    const service = Object.assign(Object.create(InternalService.prototype), {
      introspectionDataSource: { query },
    }) as InternalService;

    await expect(service.requestCoordinators(campaignId)).resolves.toEqual({ items: [] });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("g.role_code='COORDINATOR'");
    expect(sql).toContain("g.scope_type='SYSTEM'");
    expect(sql).toContain("$1::uuid IS NOT NULL AND g.scope_type='CAMPAIGN' AND (g.campaign_id=$1 OR g.campaign_id IS NULL)");
    expect(values).toEqual([campaignId]);
  });
});

describe('Identity internal team leader eligibility service', () => {
  it.each([
    [[{ reason: 'USER_NOT_FOUND' }], { eligible: false, reason: 'USER_NOT_FOUND' }],
    [[{ reason: 'USER_INACTIVE' }], { eligible: false, reason: 'USER_INACTIVE' }],
    [[{ reason: 'VOLUNTEER_GRANT_REQUIRED' }], { eligible: false, reason: 'VOLUNTEER_GRANT_REQUIRED' }],
    [[{ reason: null }], { eligible: true }],
  ] as const)('checks a system-wide volunteer grant', async (rows, expected) => {
    const query = jest.fn(async () => rows);
    const service = Object.assign(Object.create(InternalService.prototype), {
      introspectionDataSource: { query },
    }) as InternalService;
    await expect(service.teamLeaderEligibility('00000000-0000-4000-8000-000000000001')).resolves.toEqual(expected);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("g.role_code = 'VOLUNTEER'");
    expect(sql).toContain("g.scope_type = 'SYSTEM'");
    expect(values).toEqual(['00000000-0000-4000-8000-000000000001']);
  });
});
