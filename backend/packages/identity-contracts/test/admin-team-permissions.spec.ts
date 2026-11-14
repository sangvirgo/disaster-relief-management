import { hasPermission, type Grant } from '../src/permissions';

const admin: Grant = { role_code: 'ADMIN', scope_type: 'SYSTEM', organization_id: null };
const coordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: 'org-a' };

describe('team setup authorization', () => {
  it('allows a system administrator to manage teams across organizations without granting rescue dispatch', () => {
    expect(hasPermission([admin], 'TEAM_READ', { organizationId: 'org-a' })).toBe(true);
    expect(hasPermission([admin], 'TEAM_MANAGE_ANY', { organizationId: 'org-b' })).toBe(true);
    expect(hasPermission([admin], 'REQUEST_DETAIL_READ', { organizationId: 'org-a' })).toBe(false);
    expect(hasPermission([admin], 'MISSION_ASSIGN', { organizationId: 'org-a' })).toBe(false);
  });

  it('keeps coordinator team management within its organization', () => {
    expect(hasPermission([coordinator], 'TEAM_MANAGE_ANY', { organizationId: 'org-a' })).toBe(true);
    expect(hasPermission([coordinator], 'TEAM_MANAGE_ANY', { organizationId: 'org-b' })).toBe(false);
  });
});
