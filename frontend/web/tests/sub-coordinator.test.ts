import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSubCoordinatorGrants, SUB_COORDINATOR_PAGES } from '../src/auth/subCoordinator.ts';

const floating = { role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: null };
const fixed = { role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: '00000000-0000-4000-8000-0000000000c1' };
const system = { role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: null };

test('a COORDINATOR at CAMPAIGN scope without a campaign is a sub-coordinator unless it also holds SYSTEM', () => {
  assert.equal(isSubCoordinatorGrants([floating]), true);
  assert.equal(isSubCoordinatorGrants([floating, system]), false);
  assert.equal(isSubCoordinatorGrants([system]), false);
  assert.equal(isSubCoordinatorGrants([fixed]), false);
});

test('a sub-coordinator only opens campaign coordination and notices', () => {
  assert.deepEqual([...SUB_COORDINATOR_PAGES], ['campaigns', 'notices']);
});
