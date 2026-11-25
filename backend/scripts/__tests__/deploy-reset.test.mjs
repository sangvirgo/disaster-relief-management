import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const backend = new URL('../../', import.meta.url).pathname;
const HOST = 'app.example.test';
const PASSWORD = 'a-long-demo-password';

// A throwaway layout with fake docker/curl and stub db scripts, so the real reset script runs end to end.
function sandbox({ envText } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'c48-reset-'));
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  mkdirSync(bin);
  for (const dir of ['scripts/deploy', 'scripts/dev', 'scripts/db']) mkdirSync(join(root, 'backend', dir), { recursive: true });
  cpSync(join(backend, 'scripts/deploy/reset-demo-data'), join(root, 'backend/scripts/deploy/reset-demo-data'));
  cpSync(join(backend, 'scripts/dev/lib.sh'), join(root, 'backend/scripts/dev/lib.sh'));
  const calls = join(root, 'calls.log');
  // The db scripts are not executable on purpose (they are not in Git either); the reset script must run them with bash.
  writeFileSync(join(root, 'backend/scripts/db/migrate'), `#!/usr/bin/env bash\nprintf 'MIGRATE\\n' >> "${calls}"\nexit "\${FAKE_MIGRATE_STATUS:-0}"\n`);
  writeFileSync(join(root, 'backend/scripts/db/seed'),
    `#!/usr/bin/env bash\nprintf 'SEED NODE_ENV=%s PASSWORD_LENGTH=%s\\n' "$NODE_ENV" "\${#SEED_PASSWORD}" >> "${calls}"\n`);
  writeFileSync(join(root, 'backend/.env'), envText ?? [
    'NODE_ENV=production', 'C48_IMAGE_SOURCE=registry', 'PUBLIC_PORT=8080', `WEB_ALLOWED_ORIGINS=https://${HOST}`, '',
  ].join('\n'));
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "${calls}"
case "$*" in
  *"ps --status running --services"*) echo postgres ;;
  *pg_dump*) printf 'PGDMP-fake' ;;
  *"volume inspect"*) exit 0 ;;
esac
exit 0
`);
  writeFileSync(join(bin, 'aws'), `#!/usr/bin/env bash\nprintf 'aws %s\\n' "$*" >> "${calls}"\nexit 0\n`);
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\nexit "${FAKE_CURL_STATUS:-0}"\n');
  for (const name of ['docker', 'aws', 'curl']) chmodSync(join(bin, name), 0o755);

  const run = (args, { input = '', env = {} } = {}) => spawnSync('bash', [join(root, 'backend/scripts/deploy/reset-demo-data'), ...args], {
    encoding: 'utf8', input,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, C48_STATE_DIR: state, C48_HEALTH_TIMEOUT_S: '1', HOME: root, ...env },
  });
  const log = () => (existsSync(calls) ? readFileSync(calls, 'utf8') : '');
  return { root, state, run, log, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const lines = (text) => text.split('\n').filter(Boolean);
const index = (list, pattern) => list.findIndex((line) => pattern.test(line));

test('a plain reset never touches S3, and --purge-evidence empties only the two evidence buckets after the rebuild', () => {
  const env = ['NODE_ENV=production', 'C48_IMAGE_SOURCE=registry', 'PUBLIC_PORT=8080', `WEB_ALLOWED_ORIGINS=https://${HOST}`, 'S3_REGION=ap-test-1',
    'S3_RESPONSE_BUCKET=resp-evidence', 'S3_LOGISTICS_BUCKET=log-evidence', 'S3_BACKUP_BUCKET=the-backups', ''].join('\n');
  const plain = sandbox({ envText: env });
  try {
    assert.equal(plain.run(['--reset'], { input: `${PASSWORD}\n` }).status, 0);
    assert.doesNotMatch(plain.log(), /aws /u);
  } finally { plain.cleanup(); }
  const purge = sandbox({ envText: env });
  try {
    const result = purge.run(['--reset', '--purge-evidence'], { input: `${PASSWORD}\n` });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /EVIDENCE BUCKETS will be emptied/u);
    const entries = lines(purge.log());
    const seed = index(entries, /^SEED /u);
    const first = index(entries, /aws .*s3 rm s3:\/\/resp-evidence\/ --recursive/u);
    const second = index(entries, /aws .*s3 rm s3:\/\/log-evidence\/ --recursive/u);
    assert.ok(seed >= 0 && first > seed && second > first, 'purge happens after the database was rebuilt');
    assert.doesNotMatch(purge.log(), /the-backups/u, 'the backup bucket is never touched');
  } finally { purge.cleanup(); }
  const unsafe = sandbox({ envText: env.replace('S3_LOGISTICS_BUCKET=log-evidence', 'S3_LOGISTICS_BUCKET=the-backups') });
  try {
    const result = unsafe.run(['--reset', '--purge-evidence'], { input: `${PASSWORD}\n` });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /equals the backup bucket/u);
  } finally { unsafe.cleanup(); }
});

test('refuses to run without the explicit --reset flag', () => {
  const box = sandbox();
  try {
    for (const args of [[], ['reset'], ['--reset', 'extra']]) assert.notEqual(box.run(args).status, 0);
    assert.equal(box.log(), '', 'nothing may run without --reset');
  } finally { box.cleanup(); }
});

test('a short password cancels before anything is deleted', () => {
  const box = sandbox();
  try {
    const shortPassword = box.run(['--reset'], { env: { SEED_PASSWORD: 'short' } });
    assert.notEqual(shortPassword.status, 0);
    assert.match(shortPassword.stderr, /at least 10 characters/u);
    assert.doesNotMatch(box.log(), /volume rm|pg_dump|down|MIGRATE|SEED/u);
  } finally { box.cleanup(); }
});

test('a full reset dumps first, removes only c48_pgdata, migrates, seeds as development and restarts the stack', () => {
  const box = sandbox();
  try {
    const result = box.run(['--reset'], { input: `${PASSWORD}\n` });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const entries = lines(box.log());
    const order = [
      index(entries, /pg_dump .*--dbname c48_identity/u),
      index(entries, / down$/u),
      index(entries, /volume rm c48_pgdata$/u),
      index(entries, / up .*--wait.* postgres$/u),
      index(entries, / up .*--exit-code-from db-init db-init$/u),
      index(entries, /^MIGRATE$/u),
      index(entries, /^SEED /u),
      index(entries, / up .*--wait.* identity-api response-api logistics-api web nginx$/u),
    ];
    assert.ok(order.every((position) => position >= 0), `missing steps: ${JSON.stringify(order)}\n${box.log()}`);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'steps must run in this order');
    assert.equal(entries.filter((line) => /volume rm/u.test(line)).length, 1, 'exactly one volume is removed');
    assert.doesNotMatch(box.log(), /minio|down -v|--volumes|system prune/u, 'MinIO and other volumes stay untouched');
    assert.match(box.log(), new RegExp(`SEED NODE_ENV=development PASSWORD_LENGTH=${PASSWORD.length}`, 'u'));
    for (const database of ['c48_identity', 'c48_response', 'c48_logistics']) {
      assert.ok(existsSync(join(box.state, 'pre-reset', `${database}.dump`)), `${database} safety dump missing`);
    }
    assert.ok(existsSync(join(box.state, 'pre-reset', 'manifest.sha256')));
    assert.match(readFileSync(join(box.root, 'backend/.env'), 'utf8'), /^NODE_ENV=production$/mu, '.env keeps production');
  } finally { box.cleanup(); }
});

test('the password can be typed at a hidden prompt instead of the environment', () => {
  const box = sandbox();
  try {
    const result = box.run(['--reset'], { input: `${PASSWORD}\n` });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(PASSWORD, 'u'), 'the password must never be printed');
    assert.doesNotMatch(box.log(), new RegExp(PASSWORD, 'u'), 'the password must not reach a docker command line');
  } finally { box.cleanup(); }
});

test('a failing migration stops the run with a non-zero status and never starts the stack', () => {
  const box = sandbox();
  try {
    const result = box.run(['--reset'], { env: { SEED_PASSWORD: PASSWORD, FAKE_MIGRATE_STATUS: '1' } });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(box.log(), /^SEED /mu);
    assert.doesNotMatch(box.log(), /identity-api response-api logistics-api web nginx/u);
  } finally { box.cleanup(); }
});

test('failed health checks after the reseed fail the command', () => {
  const box = sandbox();
  try {
    const result = box.run(['--reset'], { env: { SEED_PASSWORD: PASSWORD, FAKE_CURL_STATUS: '22' } });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /health check failed/u);
  } finally { box.cleanup(); }
});

test('an unreadable backend/.env stops the reset before anything runs', (context) => {
  if (process.getuid?.() === 0) return context.skip('root can read every file');
  const box = sandbox();
  try {
    chmodSync(join(box.root, 'backend/.env'), 0o000);
    const result = box.run(['--reset'], { env: { SEED_PASSWORD: PASSWORD } });
    assert.notEqual(result.status, 0);
    assert.equal(box.log(), '');
  } finally { chmodSync(join(box.root, 'backend/.env'), 0o600); box.cleanup(); }
});

// The production guard of the local reset scripts must fail closed.
function guard(envText, { unreadable = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'c48-guard-'));
  try {
    mkdirSync(join(root, 'backend/scripts/dev'), { recursive: true });
    cpSync(join(backend, 'scripts/dev/lib.sh'), join(root, 'backend/scripts/dev/lib.sh'));
    const envPath = join(root, 'backend/.env');
    writeFileSync(envPath, envText);
    if (unreadable) chmodSync(envPath, 0o000);
    const env = { ...process.env };
    delete env.NODE_ENV;
    const result = spawnSync('bash', ['-c', 'source "$1"; require_nonproduction_env; echo PASSED', 'guard', join(root, 'backend/scripts/dev/lib.sh')],
      { encoding: 'utf8', env });
    if (unreadable) chmodSync(envPath, 0o600);
    return result;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('the production guard refuses production, accepts development and fails closed on an unreadable file', (context) => {
  assert.equal(guard('NODE_ENV=development\n').stdout.trim(), 'PASSED');
  const production = guard('NODE_ENV=production\n');
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /Refusing to reset a production environment/u);
  assert.notEqual(guard('NODE_ENV="production" # live\n').status, 0);
  if (process.getuid?.() === 0) return context.skip('root can read every file');
  const unreadable = guard('NODE_ENV=development\n', { unreadable: true });
  assert.notEqual(unreadable.status, 0, 'an unreadable .env must not count as non-production');
  assert.doesNotMatch(unreadable.stdout, /PASSED/u);
  assert.match(unreadable.stderr, /Cannot read backend\/\.env/u);
});

test('the GitHub Actions reset runs without a terminal: no prompt, the password from backend/.env, optional profiles restarted', () => {
  const box = sandbox({ envText: ['NODE_ENV=production', 'C48_IMAGE_SOURCE=registry', 'PUBLIC_PORT=8080', `WEB_ALLOWED_ORIGINS=https://${HOST}`,
    'SEED_PASSWORD=', 'C48_OBSERVABILITY=on', 'C48_AI_FALLBACK=on', `SEED_PASSWORD = "${PASSWORD}"\r`, ''].join('\n') });
  try {
    const result = box.run(['--reset'], { env: { SEED_PASSWORD: '' } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const entries = lines(box.log());
    assert.match(box.log(), new RegExp(`SEED NODE_ENV=development PASSWORD_LENGTH=${PASSWORD.length}`, 'u'));
    assert.ok(index(entries, /--profile observability --profile ai-fallback down$/u) >= 0, 'the optional profiles stop with the stack');
    const stack = index(entries, / up .*--wait.* identity-api response-api logistics-api web nginx$/u);
    const monitoring = index(entries, /--profile observability up --no-build -d prometheus .*grafana$/u);
    const ollama = index(entries, /--profile ai-fallback up --no-build -d ollama$/u);
    assert.ok(stack >= 0 && monitoring > stack && ollama > stack, box.log());
  } finally { box.cleanup(); }
});

test('without a password anywhere and no terminal, the reset stops before deleting anything', () => {
  const box = sandbox();
  try {
    const result = box.run(['--reset'], { env: { SEED_PASSWORD: '' } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /at least 10 characters/u);
    assert.doesNotMatch(box.log(), /volume rm|down|SEED/u);
  } finally { box.cleanup(); }
});
