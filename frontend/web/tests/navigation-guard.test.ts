import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canNavigateAway, registerNavigationGuard } from '../src/app/navigationGuard.ts';

test('cancelling departure preserves the current page until unfinished work is cleared', () => {
  const unregister = registerNavigationGuard(() => false);
  try { assert.equal(canNavigateAway(), false); }
  finally { unregister(); }
  assert.equal(canNavigateAway(), true);
});

test('accepting one warning does not bypass another unfinished operation', () => {
  const calls: string[] = [];
  const removeUpload = registerNavigationGuard(() => { calls.push('upload'); return true; });
  const removeCount = registerNavigationGuard(() => { calls.push('count'); return false; });
  try {
    assert.equal(canNavigateAway(), false);
    assert.deepEqual(calls, ['upload', 'count']);
  } finally { removeUpload(); removeCount(); }
});
