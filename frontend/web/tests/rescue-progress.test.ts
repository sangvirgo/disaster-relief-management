import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescueProgressMessage } from '../src/features/citizen/rescueProgress.ts';

test('mission completion is distinguished from request resolution', () => {
  assert.match(rescueProgressMessage('TRIAGED', { active: 0, completed: 1 })!, /Chờ xác nhận/);
  assert.match(rescueProgressMessage('IN_PROGRESS', { active: 1, completed: 1 })!, /đang xử lý/);
  for (const status of ['CLOSED', 'RESOLVED', 'REJECTED', 'CANCELLED', 'DUPLICATE'])
    assert.equal(rescueProgressMessage(status, { active: 0, completed: 1 }), null);
  assert.equal(rescueProgressMessage('TRIAGED'), null);
  assert.equal(rescueProgressMessage('TRIAGED', { active: 0, completed: 0 }), null);
});
