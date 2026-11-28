import test from 'node:test';
import assert from 'node:assert/strict';
import { readSupplyDraft, writeSupplyDraft, clearSupplyDraft, clearAllSupplyDrafts } from '../src/features/supply/supplySessionDraft.ts';
const data = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => data.set(key, value),
  removeItem: (key: string) => data.delete(key),
  key: (index: number) => [...data.keys()][index] ?? null,
  get length() { return data.size; },
} });
test('supply drafts survive reload with exact edits and remain private to one actor and mission', () => {
  data.clear();
  const lines = [{ item_id: 'water', quantity: '19' }, { item_id: 'rice', quantity: '1.25' }];
  assert.equal(writeSupplyDraft('leader', 'a', lines), true);
  assert.deepEqual(readSupplyDraft('leader', 'a'), lines);
  assert.equal(readSupplyDraft('member', 'a'), null);
  assert.equal(readSupplyDraft('leader', 'b'), null);
  clearSupplyDraft('leader', 'a');
  assert.equal(readSupplyDraft('leader', 'a'), null);
});
test('expired and duplicate supply drafts cannot become a command; logout keeps unrelated storage', () => {
  data.clear();
  writeSupplyDraft('leader', 'a', [{ item_id: 'water', quantity: '19' }]);
  const [key, raw] = [...data.entries()][0];
  data.set(key, JSON.stringify({ ...JSON.parse(raw), savedAt: Date.now() - 31 * 60_000 }));
  assert.equal(readSupplyDraft('leader', 'a'), null);
  data.set(key, JSON.stringify({ savedAt: Date.now(), lines: [{ item_id: 'water', quantity: '1' }, { item_id: 'water', quantity: '2' }] }));
  assert.equal(readSupplyDraft('leader', 'a'), null);
  writeSupplyDraft('leader', 'b', []);
  assert.deepEqual(readSupplyDraft('leader', 'b'), []);
  data.set('unrelated', 'keep');
  clearAllSupplyDrafts();
  assert.deepEqual([...data.entries()], [['unrelated', 'keep']]);
});
