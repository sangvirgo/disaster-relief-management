import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileSignature, isPendingUploadRetained, nextUploadKey, restoreUpload, uploadRetentionMs, uploadScope, type StoredUpload } from '../src/features/volunteer/missionEvidenceState.ts';

const now = Date.now();
const scope = uploadScope('leader-a', 'mission-a');
const record: StoredUpload = { id: 'original-command', scope, file: new Blob(['evidence bytes'], { type: 'image/jpeg' }), name: 'hien-truong.jpg', lastModified: 12345, updatedAt: now, state: 'uploading' };

test('reload restores the exact file bytes and original command identity, never a saved state', async () => {
  const restored = restoreUpload(record, scope, now)!;
  assert.equal(await restored.file.text(), 'evidence bytes');
  assert.equal(restored.file.name, record.name);
  assert.equal(restored.file.type, 'image/jpeg');
  assert.equal(restored.file.lastModified, record.lastModified);
  assert.equal(restored.key, record.id);
  assert.equal(restored.state, 'failed');
  assert.equal(restored.persisted, true);
});

test('another user or mission cannot restore the pending file', () => {
  assert.equal(restoreUpload(record, uploadScope('leader-b', 'mission-a'), now), null);
  assert.equal(restoreUpload(record, uploadScope('leader-a', 'mission-b'), now), null);
});

test('expired, malformed and already acknowledged uploads are not offered for retry', () => {
  assert.equal(restoreUpload({ ...record, updatedAt: now - uploadRetentionMs - 1 }, scope, now), null);
  assert.equal(restoreUpload({ ...record, lastModified: NaN }, scope, now), null);
  assert.equal(restoreUpload({ ...record, state: 'saved' }, scope, now), null);
});

test('lost responses, offline errors and timeouts keep the original key; definitive storage failures rotate it', () => {
  for (const code of [undefined, 'NETWORK_UNAVAILABLE', 'UPLOAD_TIMEOUT', 'VERSION_CONFLICT'])
    assert.equal(nextUploadKey(code, 'original', () => 'fresh'), 'original');
  assert.equal(nextUploadKey('STORAGE_UNAVAILABLE', 'original', () => 'fresh'), 'fresh');
});

test('restoration preserves duplicate-selection identity', () => {
  const restored = restoreUpload(record, scope, now)!;
  const selectedAgain = new File(['evidence bytes'], record.name, { type: 'image/jpeg', lastModified: record.lastModified });
  assert.equal(fileSignature(restored.file), fileSignature(selectedAgain));
});

test('retention cleanup applies to every user and mission, including future and invalid timestamps', () => {
  assert.equal(isPendingUploadRetained(record, now), true);
  assert.equal(isPendingUploadRetained({ ...record, scope: uploadScope('other-user', 'other-mission'), updatedAt: now - uploadRetentionMs - 1 }, now), false);
  assert.equal(isPendingUploadRetained({ ...record, updatedAt: now + 60_001 }, now), false);
  assert.equal(isPendingUploadRetained({ ...record, updatedAt: NaN }, now), false);
  assert.equal(isPendingUploadRetained({ ...record, state: 'saved' }, now), false);
});
