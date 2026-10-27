import { validGrant } from '../src/permissions';
const grant = { role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: '00000000-0000-4000-8000-000000000001' };
it('accepts the shared Identity grant transport without making authorization decisions', () => {
  expect(validGrant(grant)).toBe(true);
  expect(validGrant({ ...grant, role_code: 'ADMIN', scope_type: 'REGION', region_code: 'R1' })).toBe(true);
});
it.each([
  null, [], {}, { ...grant, role_code: 'UNKNOWN' }, { ...grant, scope_type: 'UNKNOWN' },
  { ...grant, organization_id: 'not-a-uuid' }, { ...grant, campaign_id: 'not-a-uuid' },
  { ...grant, region_code: 'R'.repeat(81) },
])('rejects malformed grants at both service boundaries: %j', (value) => {
  expect(validGrant(value)).toBe(false);
});
