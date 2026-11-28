import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAllMissionDrafts, clearMissionDraft, readMissionDraft, writeMissionDraft, type MissionDraft } from '../src/features/volunteer/missionDraft.ts';

const data = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => data.set(key, value),
  removeItem: (key: string) => data.delete(key),
  key: (index: number) => [...data.keys()][index] ?? null,
  get length() { return data.size; },
} });
const draft: MissionDraft = { status: 'ON_SCENE', action: 'complete', outcome: 'Đã đưa người dân đến nơi an toàn.', progress: '', decline: '' };

test('reload recovery is scoped to the actor, mission and current lifecycle', () => {
  data.clear();
  assert.equal(writeMissionDraft('leader', 'mission-a', draft), true);
  assert.deepEqual(readMissionDraft('leader', 'mission-a', 'ON_SCENE'), draft);
  assert.equal(readMissionDraft('member', 'mission-a', 'ON_SCENE'), null);
  assert.equal(readMissionDraft('leader', 'mission-b', 'ON_SCENE'), null);
  assert.equal(readMissionDraft('leader', 'mission-a', 'COMPLETED'), null);
  assert.equal(readMissionDraft('leader', 'mission-a', 'ON_SCENE'), null);
});

test('success/discard and logout remove drafts without clearing unrelated storage', () => {
  data.clear(); data.set('unrelated', 'keep');
  writeMissionDraft('leader', 'a', draft); writeMissionDraft('leader', 'b', draft);
  clearMissionDraft('leader', 'a');
  assert.equal(readMissionDraft('leader', 'a', 'ON_SCENE'), null);
  assert.deepEqual(readMissionDraft('leader', 'b', 'ON_SCENE'), draft);
  clearAllMissionDrafts();
  assert.deepEqual([...data.entries()], [['unrelated', 'keep']]);
});

test('expired and malformed notes cannot be restored into a mission', () => {
  data.clear(); writeMissionDraft('leader', 'a', draft);
  const [key, raw] = [...data.entries()][0];
  data.set(key, JSON.stringify({ ...JSON.parse(raw), savedAt: Date.now() - 31 * 60_000 }));
  assert.equal(readMissionDraft('leader', 'a', 'ON_SCENE'), null);
  writeMissionDraft('leader', 'a', draft);
  data.set(key, '{broken');
  assert.equal(readMissionDraft('leader', 'a', 'ON_SCENE'), null);
});
