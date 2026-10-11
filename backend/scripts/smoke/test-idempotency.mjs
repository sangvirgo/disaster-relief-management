import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { AppError } = require('../../dist/packages/technical/src/errors.js');
const { canonicalRequestHash, IdempotencyService } = require('../../dist/packages/technical/src/idempotency.js');
const { JobRunner, claimBatch } = require('../../dist/packages/technical/src/jobs.js');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const dataSource = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL, extra: { max: 3 } });
const service = new IdempotencyService();
const scopeKey = `technical-test:${randomUUID()}`;
const commandName = 'technical.idempotency.test';
const key = randomUUID();
const resource = { type: 'test_resource', id: randomUUID() };
const payload = { action: 'create', facts: { b: 2, a: 1 } };
const requestHash = canonicalRequestHash(payload, 'v1:synthetic-capability-hash');
let signalStarted;
let releaseExecution;
const started = new Promise((resolve) => { signalStarted = resolve; });
const held = new Promise((resolve) => { releaseExecution = resolve; });
let executions = 0;
let replays = 0;
let secondSettled = false;
let signalJobStarted;
let releaseJob;
const jobStarted = new Promise((resolve) => { signalJobStarted = resolve; });
const heldJob = new Promise((resolve) => { releaseJob = resolve; });

function buildCommand(hash, { execute, replay }) {
  return {
    scopeKey,
    command: commandName,
    key,
    requestHash: hash,
    execute,
    replay,
  };
}

await dataSource.initialize();
try {
  const first = service.execute(dataSource, buildCommand(requestHash, {
    execute: async () => {
      executions++;
      signalStarted();
      await held;
      return { status: 201, value: { id: resource.id }, resource };
    },
    replay: async () => { throw new Error('first request must not replay'); },
  }));
  await started;

  const second = service.execute(dataSource, buildCommand(requestHash, {
    execute: async () => { throw new Error('duplicate request must wait and replay'); },
    replay: async (manager, storedResource, status) => {
      replays++;
      assert.equal(status, 201);
      assert.deepEqual(storedResource, resource);
      const rows = await manager.query(
        'SELECT response_status, resource_type, resource_id FROM idempotency_record WHERE scope_key = $1 AND command = $2 AND idempotency_key = $3',
        [scopeKey, commandName, key],
      );
      assert.deepEqual(rows[0], { response_status: 201, resource_type: resource.type, resource_id: resource.id });
      return { id: storedResource.id };
    },
  })).finally(() => { secondSettled = true; });

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(secondSettled, false, 'duplicate INSERT should wait while the first transaction owns the key');
  releaseExecution();
  const [created, replayed] = await Promise.all([first, second]);
  assert.deepEqual(created, { status: 201, value: { id: resource.id }, replay: false });
  assert.deepEqual(replayed, { status: 201, value: { id: resource.id }, replay: true });
  assert.equal(executions, 1);
  assert.equal(replays, 1);

  await assert.rejects(
    service.execute(dataSource, buildCommand(canonicalRequestHash({ ...payload, changed: true }), {
      execute: async () => { throw new Error('reused key must not execute'); },
      replay: async () => { throw new Error('reused key must not replay'); },
    })),
    (error) => error instanceof AppError && error.code === 'IDEMPOTENCY_KEY_REUSED',
  );

  const jobs = new JobRunner(dataSource);
  const activeJob = jobs.runOnce('technical.idempotency.test', async (manager) => {
    await claimBatch(manager, 'SELECT code FROM region ORDER BY code', [], 10);
    signalJobStarted();
    await heldJob;
  });
  await jobStarted;
  assert.equal(await jobs.runOnce('technical.idempotency.test', async () => { throw new Error('overlapping job must skip'); }), false);
  releaseJob();
  assert.equal(await activeJob, true);
  console.log('PASS idempotency wait/replay/conflict and advisory-lock/SKIP-LOCKED job claim on PostgreSQL');
} finally {
  releaseExecution?.();
  releaseJob?.();
  await dataSource.query('DELETE FROM idempotency_record WHERE scope_key = $1 AND command = $2 AND idempotency_key = $3', [scopeKey, commandName, key]).catch(() => undefined);
  await dataSource.destroy();
}
