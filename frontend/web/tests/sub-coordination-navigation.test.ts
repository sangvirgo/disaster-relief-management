import assert from 'node:assert/strict';
import test from 'node:test';
import { engagementUrl } from '../src/features/coordinator/subCoordinationNavigation.ts';

const initial = 'http://localhost:5174/?workspace=coordinator&campaign_tab=workspace&engagement_id=a&sos_id=sos-in-a&sos_tab=dispatch&status=TRIAGED';
test('switching to another campaign clears the old SOS while preserving workspace filters', () => {
  const url = engagementUrl(initial, 'b', 'a');
  assert.equal(url.searchParams.get('engagement_id'), 'b');
  assert.equal(url.searchParams.has('sos_id'), false);
  assert.equal(url.searchParams.has('sos_tab'), false);
  assert.equal(url.searchParams.get('status'), 'TRIAGED');
  assert.equal(url.searchParams.get('campaign_tab'), 'workspace');
});
test('reopening the same campaign retains the current SOS and detail tab', () => {
  const url = engagementUrl(initial, 'a', 'a');
  assert.equal(url.searchParams.get('sos_id'), 'sos-in-a');
  assert.equal(url.searchParams.get('sos_tab'), 'dispatch');
});
test('leaving the last campaign removes both the saved campaign and request', () => {
  const url = engagementUrl(initial, '', 'a');
  assert.equal(url.searchParams.has('engagement_id'), false);
  assert.equal(url.searchParams.has('sos_id'), false);
  assert.equal(url.searchParams.has('sos_tab'), false);
});
