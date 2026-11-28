import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolutionErrorCopy } from '../src/i18n/resolutionErrors.ts';

test('resolution errors explain authoritative blockers rather than a generic checklist', () => {
  assert.match(resolutionErrorCopy('RESOLUTION_BLOCKED', { reasons: ['FAILED_MISSION_REVIEW_REQUIRED', 'NO_COMPLETED_MISSION_EVIDENCE'] })!, /thất bại.*chưa.*rà soát/);
  assert.match(resolutionErrorCopy('CYCLE_NOT_SETTLED', { reasons: ['RESERVED_QUANTITY'] })!, /đang giữ chỗ/);
});
test('unknown and malformed details never expose server content or inherited property names', () => {
  for (const details of [null, 'private', {}, { reasons: 'private' }, { reasons: ['private', 'toString', '__proto__', { token: 'private' }] }])
    assert.equal(resolutionErrorCopy('RESOLUTION_BLOCKED', details), undefined);
  assert.equal(resolutionErrorCopy('OTHER', { reasons: ['ACTIVE_MISSION'] }), undefined);
});
test('duplicate codes produce one explanation and mixed unknown values are discarded', () => {
  const copy = resolutionErrorCopy('RESOLUTION_BLOCKED', { reasons: ['OPEN_NEED', 'OPEN_NEED', 'private'] })!;
  assert.equal(copy.match(/nhu cầu vật tư/g)?.length, 1);
  assert.doesNotMatch(copy, /private/);
});
