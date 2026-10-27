import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Execute the real shell entrypoints with command-boundary doubles. No database,
// container, network, or real backup contents are involved.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'c48-recovery-test-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.C48_TEST_LOG, JSON.stringify({ name, args }) + '\\n');
if (name === 'docker') {
  if (args.includes('config')) console.log(JSON.stringify({services:{minio:{ports:[{target:9000,protocol:'tcp',host_ip:'127.0.0.1',published:'59000'}]}}}));
  else if (args.includes('pg_dump')) console.log('mock custom archive');
  else console.log('111111111');
} else if (name === 'psql') {
  if (args.some(a => a.includes('system_identifier'))) console.log('222222222');
  else if (args.some(a => a.includes('user_objects'))) console.log('0');
  else if (args.some(a => a.includes('current_database()'))) console.log('c48_recovery_' + args[0].replace('service=recovery-', ''));
  else if (args.some(a => a.endsWith('recovery-roles.sql'))) console.log(process.env.C48_TEST_ROLES_OK || 't');
  else if (args.some(a => a.endsWith('recovery-privileges.sql'))) console.log(process.env.C48_TEST_PRIVILEGES_OK || 't');
}
`;
  for (const name of ['docker', 'psql', 'pg_restore', 'mc']) writeFileSync(join(bin, name), stub, { mode: 0o700 });
  const config = join(root, 'mc');
  mkdirSync(config, { mode: 0o700 });
  writeFileSync(join(config, 'config.json'), JSON.stringify({ aliases: { backup: { url: 'http://127.0.0.1:59000' } } }), { mode: 0o600 });
  const service = join(root, 'pg_service.conf');
  writeFileSync(service, '# command doubles never connect', { mode: 0o600 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MC_CONFIG_DIR: config, C48_MINIO_ALIAS: 'backup',
    C48_TEST_LOG: join(root, 'commands.jsonl'), PGSERVICEFILE: service,
    PGSERVICE_IDENTITY: 'recovery-identity', PGSERVICE_RESPONSE: 'recovery-response', PGSERVICE_LOGISTICS: 'recovery-logistics',
    C48_RESTORE_CONFIRM: 'I_HAVE_AN_ISOLATED_DESTINATION' };
  const run = (script, argument, overrides = {}) => spawnSync('bash', [fileURLToPath(new URL(`../db/${script}`, import.meta.url)), argument], { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000 });
  const backup = run('backup', join(root, 'backups'));
  assert.equal(backup.status, 0, backup.stderr);
  const backupPath = backup.stdout.trim().replace('Private backup created: ', '');
  return { root, env, run, backupPath, calls: () => readFileSync(env.C48_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('backup/restore retains archive owners and ACLs and verifies role and stock boundaries', () => {
  const f = fixture();
  try {
    const result = f.run('restore', f.backupPath);
    assert.equal(result.status, 0, result.stderr);
    const calls = f.calls();
    const dumps = calls.filter(c => c.name === 'docker' && c.args.includes('pg_dump'));
    assert.equal(dumps.length, 3);
    const restores = calls.filter(c => c.name === 'pg_restore' && c.args.some(a => a.startsWith('--dbname=')));
    assert.equal(restores.length, 3);
    for (const call of [...dumps, ...restores]) {
      assert.ok(!call.args.includes('--no-owner'));
      assert.ok(!call.args.includes('--no-acl'));
    }
    assert.equal(calls.filter(c => c.args.some(a => a.endsWith('recovery-roles.sql'))).length, 3);
    assert.equal(calls.filter(c => c.args.some(a => a.endsWith('recovery-privileges.sql'))).length, 3);
    assert.ok(restores.every(c => c.args.includes('--single-transaction')));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('missing recovery roles stop every archive restore before mutation', () => {
  const f = fixture();
  try {
    const result = f.run('restore', f.backupPath, { C48_TEST_ROLES_OK: 'f' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /roles|ownership/u);
    assert.equal(f.calls().filter(c => c.name === 'pg_restore' && c.args.some(a => a.startsWith('--dbname='))).length, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('restore fails closed if restored application privileges are wrong', () => {
  const f = fixture();
  try {
    const result = f.run('restore', f.backupPath, { C48_TEST_PRIVILEGES_OK: 'f' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /privileges|ownership/u);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
