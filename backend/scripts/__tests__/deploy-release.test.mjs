import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const backend = new URL('../../', import.meta.url).pathname;

// A throwaway repository layout with fake docker/git/curl so the real release script runs end to end.
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'c48-release-'));
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  mkdirSync(bin);
  for (const dir of ['scripts/deploy', 'scripts/dev', 'scripts/db']) mkdirSync(join(root, 'backend', dir), { recursive: true });
  cpSync(join(backend, 'scripts/deploy/release'), join(root, 'backend/scripts/deploy/release'));
  cpSync(join(backend, 'scripts/dev/lib.sh'), join(root, 'backend/scripts/dev/lib.sh'));
  writeFileSync(join(root, 'backend/scripts/db/migrate'), '#!/usr/bin/env bash\nexit "${FAKE_MIGRATE_STATUS:-0}"\n');
  // Not executable on purpose: the real db/migrate is not marked executable in Git, so release must run it with bash.
  writeFileSync(join(root, 'backend/.env'), [
    'C48_IMAGE_SOURCE=registry', 'C48_IMAGE_NAMESPACE=ghcr.io/example', 'C48_IMAGE_TAG=latest', 'PUBLIC_PORT=8080', '',
  ].join('\n'));
  const calls = join(root, 'calls.log');
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "${calls}"
env_file=''
for ((i = 1; i <= $#; i++)); do if [[ "\${!i}" == --env-file ]]; then j=$((i + 1)); env_file="\${!j}"; fi; done
case "$*" in
  *"ps --status running --services"*) echo postgres ;;
  *pg_dump*) printf 'PGDMP-fake' ;;
  *"--force-recreate"*) [[ "$FAKE_NGINX_FAIL" == 1 && -n "$env_file" ]] && grep -q "^C48_IMAGE_TAG=bbb$" "$env_file" && exit 1; exit 0 ;;
  *" up "*) if [[ -n "$env_file" ]] && grep -q "^C48_IMAGE_TAG=$FAKE_FAIL_TAG$" "$env_file"; then exit 1; fi ;;
  *"image ls"*) printf 'ghcr.io/example/web:old1\\nghcr.io/example/web:aaa\\nghcr.io/example/web:bbb\\nother/image:old1\\n' ;;
esac
exit 0
`);
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> "${calls}"\n[[ "$*" == *rev-parse* ]] && echo abc1234\nexit 0\n`);
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\nexit "${FAKE_CURL_STATUS:-0}"\n');
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash\nprintf 'systemctl %s\\n' "$*" >> "${calls}"\nexit 0\n`);
  for (const name of ['docker', 'git', 'curl', 'systemctl']) chmodSync(join(bin, name), 0o755);
  mkdirSync(join(root, 'backend/infra/systemd'), { recursive: true });
  mkdirSync(join(root, 'units'));
  for (const unit of ['c48-backup.service', 'c48-backup.timer', 'c48-container-metrics.service', 'c48-container-metrics.timer']) cpSync(join(backend, 'infra/systemd', unit), join(root, 'backend/infra/systemd', unit));

  const run = (...args) => {
    const extraEnv = typeof args.at(-1) === 'object' ? args.pop() : {};
    return spawnSync('bash', [join(root, 'backend/scripts/deploy/release'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, C48_STATE_DIR: state, C48_HEALTH_TIMEOUT_S: '1', C48_SYSTEMD_DIR: join(root, 'units'), HOME: root, ...extraEnv },
    });
  };
  const envTag = () => readFileSync(join(root, 'backend/.env'), 'utf8').match(/^C48_IMAGE_TAG=(.*)$/mu)[1];
  const release = (name) => (existsSync(join(state, 'releases', name)) ? readFileSync(join(state, 'releases', name), 'utf8').trim() : null);
  return { root, state, calls, run, envTag, release, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a first release records the tag, switches Git and keeps no previous release', () => {
  const box = sandbox();
  try {
    const result = box.run('deploy', 'aaa');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(box.envTag(), 'aaa');
    assert.equal(box.release('current'), 'aaa');
    assert.equal(box.release('previous'), null);
    const log = readFileSync(box.calls, 'utf8');
    assert.match(log, /git .*checkout --quiet --detach aaa/u);
    assert.match(log, /pull identity-api response-api logistics-api web/u);
    assert.match(log, / up --no-build -d --wait --wait-timeout 1 identity-api response-api logistics-api web nginx/u);
  } finally { box.cleanup(); }
});

test('a second release keeps the previous tag, the previous .env and one verified pre-deploy dump', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('deploy', 'aaa').status, 0);
    const logBeforeSecond = readFileSync(box.calls, 'utf8').length;
    const result = box.run('deploy', 'bbb');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(box.release('current'), 'bbb');
    assert.equal(box.release('previous'), 'aaa');
    assert.match(readFileSync(join(box.state, 'env.previous'), 'utf8'), /^C48_IMAGE_TAG=aaa$/mu);
    for (const database of ['c48_identity', 'c48_response', 'c48_logistics']) {
      assert.ok(existsSync(join(box.state, 'pre-deploy', `${database}.dump`)), `${database} dump missing`);
    }
    assert.ok(existsSync(join(box.state, 'pre-deploy', 'manifest.sha256')));
    const secondRelease = readFileSync(box.calls, 'utf8').slice(logBeforeSecond);
    assert.match(secondRelease, /image rm ghcr\.io\/example\/web:old1/u, 'older images are pruned');
    assert.doesNotMatch(secondRelease, /image rm (ghcr\.io\/example\/web:(?:aaa|bbb)|other\/image)/u, 'current, previous and foreign images stay');
  } finally { box.cleanup(); }
});

test('a release whose containers fail to start is rolled back automatically to the previous tag and .env', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('deploy', 'aaa').status, 0);
    assert.equal(box.run('deploy', 'bbb').status, 0);
    const result = box.run('deploy', 'bad', { FAKE_FAIL_TAG: 'bad' });
    assert.notEqual(result.status, 0, 'a failed release must fail the pipeline');
    assert.equal(box.envTag(), 'bbb', 'the previous .env must be restored');
    assert.equal(box.release('current'), 'bbb');
    assert.equal(box.release('previous'), null);
    assert.match(result.stderr, /previous release bbb was restored/u);
    assert.match(readFileSync(box.calls, 'utf8'), /git .*checkout --quiet --detach bbb/u);
  } finally { box.cleanup(); }
});

test('a failing migration is rolled back before the new containers start', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('deploy', 'aaa').status, 0);
    const result = box.run('deploy', 'bbb', { FAKE_MIGRATE_STATUS: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(box.envTag(), 'aaa');
    assert.equal(box.release('current'), 'aaa');
    assert.match(readFileSync(join(box.state, 'pre-deploy', 'manifest.txt'), 'utf8'), /release_before=aaa/u);
  } finally { box.cleanup(); }
});

test('failed health checks fail the release and the manual rollback command restores the previous release', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('deploy', 'aaa').status, 0);
    const failed = box.run('deploy', 'bbb', { FAKE_CURL_STATUS: '22' });
    assert.notEqual(failed.status, 0, 'unhealthy releases fail the pipeline');
    assert.match(failed.stdout, /health check failed/u);
    assert.match(failed.stderr, /automatic rollback failed/u, 'the fake keeps failing, so the rollback cannot succeed either');
    assert.equal(box.release('current'), 'aaa', 'the failed release is never recorded as current');
  } finally { box.cleanup(); }

  const other = sandbox();
  try {
    assert.equal(other.run('deploy', 'aaa').status, 0);
    assert.equal(other.run('deploy', 'bbb').status, 0);
    const rolled = other.run('rollback');
    assert.equal(rolled.status, 0, rolled.stdout + rolled.stderr);
    assert.equal(other.envTag(), 'aaa');
    assert.equal(other.release('current'), 'aaa');
    assert.notEqual(other.run('rollback').status, 0, 'only one step back is recorded');
  } finally { other.cleanup(); }
});

test('invalid image tags and a missing .env are refused', () => {
  const box = sandbox();
  try {
    assert.notEqual(box.run('deploy', 'bad tag; rm -rf /').status, 0);
    assert.notEqual(box.run('deploy', '').status, 0);
    assert.notEqual(box.run('unknown').status, 0);
  } finally { box.cleanup(); }
});

test('a release installs the c48 timers once and leaves unchanged units alone', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('deploy', 'aaa').status, 0);
    const service = readFileSync(join(box.root, 'units/c48-backup.service'), 'utf8');
    assert.ok(service.includes(`ExecStart=/usr/bin/bash ${box.root}/backend/scripts/deploy/backup-s3`), 'the repository path is rendered into the unit');
    assert.ok(!service.includes('@ROOT@'));
    assert.match(readFileSync(join(box.root, 'units/c48-backup.timer'), 'utf8'), /OnCalendar=\*-\*-\* 19:00:00 UTC/u);
    let log = readFileSync(box.calls, 'utf8');
    assert.equal((log.match(/systemctl daemon-reload/gu) ?? []).length, 1);
    assert.match(log, /systemctl enable --now c48-backup\.timer c48-container-metrics\.timer/u);
    assert.ok(readFileSync(join(box.root, 'units/c48-container-metrics.service'), 'utf8').includes(`${box.root}/backend/scripts/deploy/container-metrics`));

    assert.equal(box.run('deploy', 'bbb').status, 0);
    log = readFileSync(box.calls, 'utf8');
    assert.equal((log.match(/systemctl daemon-reload/gu) ?? []).length, 1, 'unchanged units must not trigger another reload');
  } finally { box.cleanup(); }
});

test('the observability profile is started only when C48_OBSERVABILITY=on, and its failure never fails the release', () => {
  const off = sandbox();
  try {
    assert.equal(off.run('deploy', 'aaa').status, 0);
    assert.equal(readFileSync(off.calls, 'utf8').includes('--profile observability'), false);
  } finally { off.cleanup(); }

  const on = sandbox();
  try {
    writeFileSync(join(on.root, 'backend/.env'), `${readFileSync(join(on.root, 'backend/.env'), 'utf8')}C48_OBSERVABILITY=on\n`);
    const result = on.run('deploy', 'aaa');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const log = readFileSync(on.calls, 'utf8');
    assert.match(log, /--profile observability pull --quiet prometheus alertmanager node-exporter postgres-exporter grafana/u);
    assert.match(log, /--profile observability up --no-build -d prometheus alertmanager node-exporter postgres-exporter grafana/u);
    assert.match(result.stdout, /observability profile is up/u);
  } finally { on.cleanup(); }
});

test('a release recreates nginx after starting the stack so it sees the new bind-mounted file', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('deploy', 'aaa').status, 0);
    const log = readFileSync(box.calls, 'utf8');
    assert.match(log, /up --no-build -d --no-deps --force-recreate --wait --wait-timeout \d+ nginx/u);
    assert.ok(log.indexOf('--force-recreate') > log.indexOf('up --no-build -d --wait'), 'nginx is recreated after the main start');
  } finally { box.cleanup(); }
});

test('a release fails and rolls back when nginx cannot start with the new configuration', () => {
  const box = sandbox();
  try {
    assert.equal(box.run('deploy', 'aaa').status, 0);
    const result = box.run('deploy', 'bbb', { FAKE_NGINX_FAIL: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /nginx did not start/u);
    assert.equal(box.release('current'), 'aaa');
  } finally { box.cleanup(); }
});
