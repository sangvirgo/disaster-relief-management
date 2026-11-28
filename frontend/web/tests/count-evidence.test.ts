import assert from 'node:assert/strict';
import test from 'node:test';
import { appendCountEvidence, uploadCountEvidence, type CountEvidence } from '../src/features/operations/countEvidence.ts';

const image = (name: string) => new File(['image'], name, { type: 'image/png', lastModified: 1 });
let sequence = 0;
const key = () => `file-${++sequence}`;

test('counting evidence appends, deduplicates within and across selections, and keeps five files', () => {
  const a = image('a.png');
  const first = appendCountEvidence([], [a, a, image('b.png')], key);
  assert.equal(first.entries.length, 2);
  const next = appendCountEvidence(first.entries, [a, ...['c', 'd', 'e', 'f'].map(name => image(`${name}.png`))], key);
  assert.equal(next.entries.length, 5);
  assert.match(next.error, /tối đa 5/);
  assert.equal(next.entries[0].key, first.entries[0].key);
  const removed = next.entries.filter(entry => entry.file.name !== 'a.png');
  assert.equal(appendCountEvidence(removed, [a], key).entries.length, 5);
});

test('invalid selections do not replace valid files or block other valid incoming files', () => {
  const result = appendCountEvidence([], [new File(['bad'], 'bad.txt', { type: 'text/plain' }), image('good.png')], key);
  assert.equal(result.entries.length, 1);
  assert.match(result.error, /bad.txt/);
});

test('a partial failure keeps successful uploads and retries only unfinished files with the same keys', async () => {
  let entries = appendCountEvidence([], ['a', 'b', 'c'].map(name => image(`${name}.png`)), key).entries;
  const update = (id: string, patch: Pick<CountEvidence, 'state' | 'error'>) => { entries = entries.map(entry => entry.key === id ? { ...entry, ...patch } : entry); };
  const calls: string[] = [];
  const failed = await uploadCountEvidence(entries, async entry => {
    calls.push(entry.key);
    if (entry.file.name === 'b.png') throw new Error('Mất kết nối');
    return { state: 'READY' };
  }, update);
  assert.equal(failed, 1);
  assert.equal(entries[0].state, 'ready');
  assert.equal(entries[2].state, 'ready');
  assert.equal(entries[1].error, 'Mất kết nối');
  const originalKey = entries[1].key;
  calls.length = 0;
  assert.equal(await uploadCountEvidence(entries, async entry => { calls.push(entry.key); return { state: 'READY' }; }, update), 0);
  assert.deepEqual(calls, [originalKey]);
  assert.ok(entries.every(entry => entry.state === 'ready'));
});

test('pending storage does not count as a confirmed upload', async () => {
  const entries = appendCountEvidence([], [image('a.png')], key).entries;
  const updates: unknown[] = [];
  assert.equal(await uploadCountEvidence(entries, async () => ({ state: 'PENDING' }), (_key, patch) => updates.push(patch)), 1);
  assert.equal((updates.at(-1) as CountEvidence).state, 'failed');
});
