import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCurrentFailureReview } from '../src/features/coordinator/missionFailureReview.ts';
test('legacy and stale failure reviews keep the required review action visible', () => {
  const event = { event_type: 'MISSION_FAILURE_REVIEW', payload: { mission_id: 'failed', mission_version: 3 } };
  assert.equal(hasCurrentFailureReview({ id: 'failed', version: 3 }, [event]), true);
  assert.equal(hasCurrentFailureReview({ id: 'failed', version: 4 }, [event]), false);
  assert.equal(hasCurrentFailureReview({ id: 'other', version: 3 }, [event]), false);
  assert.equal(hasCurrentFailureReview({ id: 'failed' }, [event]), false);
  assert.equal(hasCurrentFailureReview({ id: 'failed', version: 3 }, [{ event_type: event.event_type, payload: { mission_id: 'failed' } }]), false);
});
