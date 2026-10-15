import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compose = await readFile(new URL('../../infra/compose.yaml', import.meta.url), 'utf8');
const example = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');

test('main stack enables scheduled campaign synchronization by default', () => {
  assert.equal((compose.match(/SCHEDULER_ENABLED:\s*'\$\{SCHEDULER_ENABLED:-true\}'/gu) ?? []).length, 2);
  assert.match(example, /^SCHEDULER_ENABLED=true$/mu);
});
