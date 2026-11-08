import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceFileError } from '../src/i18n/evidence.ts';

test('empty files are rejected even with an allowed evidence MIME type', () => {
  for (const type of ['image/jpeg', 'image/png', 'video/mp4'])
    assert.match(evidenceFileError({ type, size: 0 }) || '', /không có nội dung/);
});

test('unsupported evidence types are rejected before upload', () => {
  for (const type of ['text/plain', 'application/pdf', ''])
    assert.ok(evidenceFileError({ type, size: 100 }));
});

test('image metadata accepts the server size boundary and rejects one byte over', () => {
  for (const type of ['image/jpeg', 'image/png']) {
    assert.equal(evidenceFileError({ type, size: 10 * 1024 * 1024 }), null);
    assert.ok(evidenceFileError({ type, size: 10 * 1024 * 1024 + 1 }));
  }
});

test('video metadata keeps the distinct 50 MiB server size boundary', () => {
  assert.equal(evidenceFileError({ type: 'video/mp4', size: 50 * 1024 * 1024 }), null);
  assert.ok(evidenceFileError({ type: 'video/mp4', size: 50 * 1024 * 1024 + 1 }));
});
