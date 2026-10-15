import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrations = [
  ['Identity', new URL('../../apps/identity/src/database/migrate.ts', import.meta.url)],
  ['Response', new URL('../../apps/response/src/database/migrate.ts', import.meta.url)],
  ['Logistics', new URL('../../apps/logistics/src/database/migrate.ts', import.meta.url)],
];

for (const [service, path] of migrations) {
  test(`${service} migration failures log a stable code without exception details`, async () => {
    const source = await readFile(path, 'utf8');
    const failureHandler = source.match(/main\(\)\.catch\(\(\) => \{([\s\S]*?)\n\}\);\s*$/u)?.[1];

    assert.ok(failureHandler, `${service} migration must have a catch-all failure handler`);
    assert.deepEqual(failureHandler.split('\n').map((line) => line.trim()).filter(Boolean), [
      `process.stderr.write('${service} migration failed: MIGRATION_FAILED\\n');`,
      'process.exitCode = 1;',
    ]);
  });
}
