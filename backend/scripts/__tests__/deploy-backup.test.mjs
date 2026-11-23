import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const backend = new URL('../../', import.meta.url).pathname;
const BUCKET = 'c48-backup-test';

// A throwaway repository with fake docker, curl and aws (a directory acts as S3) so the real scripts run end to end.
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'c48-backup-'));
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  const s3 = join(root, 's3');
  mkdirSync(bin);
  mkdirSync(join(s3, BUCKET), { recursive: true });
  for (const dir of ['scripts/deploy', 'scripts/dev', 'scripts/db']) mkdirSync(join(root, 'backend', dir), { recursive: true });
  for (const file of ['scripts/deploy/backup-s3', 'scripts/deploy/restore-s3', 'scripts/dev/lib.sh']) cpSync(join(backend, file), join(root, 'backend', file));
  writeFileSync(join(root, 'backend/scripts/db/migrate'), '#!/usr/bin/env bash\nprintf "migrate\\n" >> "$FAKE_CALLS"\n');
  writeFileSync(join(root, 'backend/.env'), [
    'C48_IMAGE_SOURCE=registry', 'PUBLIC_PORT=8080', 'S3_REGION=ap-southeast-2', `S3_BACKUP_BUCKET=${BUCKET}`,
    'WEB_ALLOWED_ORIGINS=https://reliva.example.test', '',
  ].join('\n'));
  const calls = join(root, 'calls.log');
  writeFileSync(calls, '');
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$FAKE_CALLS"
case "$*" in
  *"ps --status running --services"*) echo postgres ;;
  *"volume inspect"*) exit 0 ;;
  *pg_dump*) db="\${*##*--dbname }"; db="\${db%% *}"; printf 'PGDMP-%s-%s' "$db" "$RANDOM$RANDOM" ;;
  *"pg_restore --list"*) cat >/dev/null; exit "\${FAKE_LIST_STATUS:-0}" ;;
  *pg_restore*) cat >/dev/null; exit "\${FAKE_RESTORE_STATUS:-0}" ;;
esac
exit 0
`);
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\nexit 0\n');
  writeFileSync(join(bin, 'aws'), `#!/usr/bin/env bash
# Minimal s3api over a directory: $FAKE_S3/<bucket>/<key>, checksum kept beside it.
args=("$@"); op=''; bucket=''; key=''; body=''; sum=''; prefix=''; query=''; out=''
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
    s3api) op="\${args[i+1]}" ;;
    --bucket) bucket="\${args[i+1]}" ;; --key) key="\${args[i+1]}" ;; --body) body="\${args[i+1]}" ;;
    --checksum-sha256) sum="\${args[i+1]}" ;; --prefix) prefix="\${args[i+1]}" ;; --query) query="\${args[i+1]}" ;;
  esac
done
out="\${args[$((\${#args[@]}-1))]}"
dir="$FAKE_S3/$bucket"
printf 'aws %s %s %s\\n' "$op" "$bucket" "$key" >> "$FAKE_CALLS"
case "$op" in
  put-object)
    actual="$(openssl dgst -sha256 -binary "$body" | base64 -w0)"
    [[ -n "$FAKE_S3_CORRUPT" && "$key" == *"$FAKE_S3_CORRUPT"* ]] && actual=bad
    [[ "$actual" == "$sum" ]] || { echo 'BadDigest' >&2; exit 254; }
    mkdir -p "$(dirname "$dir/$key")"; cp "$body" "$dir/$key"; printf '%s' "$sum" > "$dir/$key.sum" ;;
  head-object)
    [[ -f "$dir/$key" ]] || exit 254
    if [[ "$query" == *ContentLength* ]]; then printf '%s\\t%s\\n' "$(cat "$dir/$key.sum")" "$(stat -c %s "$dir/$key")"
    elif [[ "$query" == ChecksumSHA256 ]]; then cat "$dir/$key.sum"; echo; fi ;;
  get-object) cp "$dir/$key" "$out" ;;
  delete-object) rm -f "$dir/$key" "$dir/$key.sum"; rmdir "$(dirname "$dir/$key")" 2>/dev/null ;;
  list-objects-v2)
    if [[ "$query" == *CommonPrefixes* ]]; then
      list="$(cd "$dir" 2>/dev/null && find backups -mindepth 1 -maxdepth 1 -type d -printf 'backups/%f/\\n' | sort | tr '\\n' ' ')"
      echo "\${list:-None}"
    else
      list="$(cd "$dir" 2>/dev/null && find "$prefix" -type f ! -name '*.sum' 2>/dev/null | sort | tr '\\n' ' ')"
      echo "\${list:-None}"
    fi ;;
esac
exit 0
`);
  for (const name of ['docker', 'curl', 'aws']) chmodSync(join(bin, name), 0o755);

  const run = (script, args = [], extraEnv = {}) => spawnSync('bash', [join(root, 'backend/scripts/deploy', script), ...args], {
    encoding: 'utf8',
    input: '',
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, C48_STATE_DIR: state, C48_HEALTH_TIMEOUT_S: '1', HOME: root,
      FAKE_CALLS: calls, FAKE_S3: s3, FAKE_S3_CORRUPT: '', C48_BACKUP_LOCK_WAIT_S: '1', ...extraEnv,
    },
  });
  const prefixes = () => (existsSync(join(s3, BUCKET, 'backups')) ? readdirSync(join(s3, BUCKET, 'backups')).sort() : []);
  const log = () => readFileSync(calls, 'utf8');
  const metrics = () => readFileSync(join(state, 'metrics', 'c48_backup.prom'), 'utf8');
  return { root, state, s3, run, prefixes, log, metrics, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test('three consecutive backups leave exactly the two newest, each fully verified', () => {
  const box = sandbox();
  try {
    for (let i = 0; i < 3; i += 1) {
      const result = box.run('backup-s3');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      wait(1100);
    }
    const kept = box.prefixes();
    assert.equal(kept.length, 2);
    for (const stamp of kept) {
      const files = readdirSync(join(box.s3, BUCKET, 'backups', stamp)).filter((name) => !name.endsWith('.sum')).sort();
      assert.deepEqual(files, ['c48_identity.dump', 'c48_logistics.dump', 'c48_response.dump', 'manifest.sha256', 'manifest.txt']);
    }
    assert.match(box.metrics(), /^c48_backup_last_run_success 1$/mu);
    assert.match(box.metrics(), /^c48_backup_retained_count 2$/mu);
    assert.match(box.metrics(), /^c48_backup_last_success_timestamp_seconds [1-9][0-9]+$/mu);
    assert.equal(statSync(join(box.state, 'metrics')).mode & 0o777, 0o755, 'node_exporter (user nobody) must be able to read the metrics directory');
  } finally { box.cleanup(); }
});

test('a damaged upload deletes nothing and keeps the old last-success time', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('backup-s3').status, 0);
    wait(1100);
    assert.equal(box.run('backup-s3').status, 0);
    wait(1100);
    const before = box.prefixes();
    const last = readFileSync(join(box.state, 'backup/last-success'), 'utf8');
    const result = box.run('backup-s3', [], { FAKE_S3_CORRUPT: 'c48_response.dump' });
    assert.notEqual(result.status, 0);
    assert.deepEqual(box.prefixes().slice(0, 2), before, 'both earlier backups must survive');
    assert.equal(box.log().includes('aws delete-object'), false, 'no delete call may happen before the new backup is verified');
    assert.match(box.metrics(), /^c48_backup_last_run_success 0$/mu);
    assert.equal(readFileSync(join(box.state, 'backup/last-success'), 'utf8'), last);
  } finally { box.cleanup(); }
});

test('a dump that pg_restore --list rejects is never uploaded', () => {
  const box = sandbox();
  try {
    const result = box.run('backup-s3', [], { FAKE_LIST_STATUS: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(box.log().includes('aws put-object'), false);
    assert.deepEqual(box.prefixes(), []);
    assert.match(box.metrics(), /^c48_backup_last_run_success 0$/mu);
  } finally { box.cleanup(); }
});

test('the backup refuses to run without a bucket and keeps fewer than two copies impossible', () => {
  const box = sandbox();
  try {
    const env = join(box.root, 'backend/.env');
    writeFileSync(env, readFileSync(env, 'utf8').replace(/^S3_BACKUP_BUCKET=.*$/mu, 'S3_BACKUP_BUCKET='));
    assert.notEqual(box.run('backup-s3').status, 0);
    writeFileSync(env, readFileSync(env, 'utf8').replace(/^S3_BACKUP_BUCKET=.*$/mu, `S3_BACKUP_BUCKET=${BUCKET}`));
    const one = box.run('backup-s3', [], { C48_BACKUP_KEEP: '1' });
    assert.notEqual(one.status, 0);
    assert.match(one.stderr, /between 2 and 9/u);
  } finally { box.cleanup(); }
});

test('restore --list and --verify read a complete backup without changing anything', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('backup-s3').status, 0);
    const listed = box.run('restore-s3', ['--list']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout.trim(), /^[0-9]{8}T[0-9]{6}Z$/u);
    const verified = box.run('restore-s3', ['--verify']);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.match(verified.stdout, /downloaded and verified/u);
    assert.equal(box.log().includes('volume rm'), false);
  } finally { box.cleanup(); }
});

test('restore --reset needs the hostname, removes only c48_pgdata and restores all three databases', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('backup-s3').status, 0);
    const refused = box.run('restore-s3', ['--reset'], { C48_CONFIRM_HOSTNAME: 'wrong.example.test' });
    assert.notEqual(refused.status, 0);
    assert.equal(box.log().includes('volume rm'), false, 'a wrong hostname must change nothing');

    const ok = box.run('restore-s3', ['--reset'], { C48_CONFIRM_HOSTNAME: 'reliva.example.test' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const log = box.log();
    assert.deepEqual(log.match(/^docker volume rm .*$/gmu), ['docker volume rm c48_pgdata']);
    for (const database of ['c48_identity', 'c48_response', 'c48_logistics']) assert.match(log, new RegExp(`pg_restore .*--dbname ${database} --clean`, 'u'));
    assert.ok(log.indexOf('volume rm') > log.indexOf('pg_dump'), 'the safety dump comes before the volume is removed');
    assert.ok(log.indexOf('migrate') > log.lastIndexOf('--clean'), 'migrations run after the data is restored');
    assert.ok(existsSync(join(box.state, 'pre-restore/manifest.sha256')));
  } finally { box.cleanup(); }
});

test('a corrupted download stops restore --reset before anything is deleted', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('backup-s3').status, 0);
    const stamp = box.prefixes()[0];
    writeFileSync(join(box.s3, BUCKET, 'backups', stamp, 'c48_logistics.dump'), 'tampered');
    const result = box.run('restore-s3', ['--reset'], { C48_CONFIRM_HOSTNAME: 'reliva.example.test' });
    assert.notEqual(result.status, 0);
    assert.equal(box.log().includes('volume rm'), false);
    assert.equal(box.log().includes('docker compose') && /\bdown\b/u.test(box.log()), false);
  } finally { box.cleanup(); }
});
