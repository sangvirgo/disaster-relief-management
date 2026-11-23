import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { load } from 'js-yaml';

const infra = new URL('../../infra/', import.meta.url).pathname;
const read = (path) => readFileSync(join(infra, path), 'utf8');

test('alert rules cover the required conditions and read in Vietnamese', () => {
  const groups = load(read('observability/rules.yml')).groups;
  const rules = groups.flatMap((group) => group.rules);
  const names = rules.map((rule) => rule.alert);
  for (const required of ['TargetDown', 'DiskAlmostFull', 'MemoryLow', 'SwapHigh', 'ApiServerErrors', 'PostgresConnectionsNearLimit',
    'ContainerRestarting', 'BackupTooOld', 'ApiLatencyHigh', 'GeminiMostCallsFailing', 'GeminiKeyQuotaExceeded', 'GeminiKeyRejected', 'AiDailyLimitNear']) assert.ok(names.includes(required), `${required} is missing`);
  assert.equal(new Set(names).size, names.length, 'alert names must be unique');
  for (const rule of rules) {
    assert.ok(['warning', 'critical'].includes(rule.labels?.severity), `${rule.alert} needs a severity`);
    assert.match(rule.annotations.summary, /[ăâđêôơưáàảãạéèíìóòúùýỳ]|\b(?:không|cho|của|đã|lần)\b/iu, `${rule.alert} summary must be Vietnamese`);
    assert.ok(rule.annotations.description, `${rule.alert} needs a description`);
  }
  const byName = Object.fromEntries(rules.map((rule) => [rule.alert, rule]));
  assert.match(byName.DiskAlmostFull.expr, /> 0\.80/u);
  assert.match(byName.BackupTooOld.expr, /26 \* 3600/u);
  assert.match(byName.PostgresConnectionsNearLimit.expr, /> 0\.80/u);
});

test('Prometheus scrapes the services on the internal network with the ports Compose publishes', () => {
  const config = load(read('observability/prometheus.yml'));
  const targets = Object.fromEntries(config.scrape_configs.map((job) => [job.job_name, job.static_configs[0].targets[0]]));
  assert.deepEqual(targets, {
    prometheus: 'localhost:9090', alertmanager: 'alertmanager:9093', node: 'node-exporter:9100', postgres: 'postgres-exporter:9187',
    'identity-api': 'identity-api:3001', 'response-api': 'response-api:3002', 'logistics-api': 'logistics-api:3003',
  });
  assert.deepEqual(config.alerting.alertmanagers[0].static_configs[0].targets, ['alertmanager:9093']);
});

test('the dashboard is valid, uses the provisioned data source and covers the requested areas', () => {
  const dashboard = JSON.parse(read('observability/grafana/dashboards/c48-overview.json'));
  const datasource = load(read('observability/grafana/provisioning/datasources/prometheus.yml')).datasources[0];
  const panels = dashboard.panels.filter((panel) => panel.type !== 'row');
  assert.ok(panels.length >= 20);
  for (const panel of panels) assert.equal(panel.datasource.uid, datasource.uid, `${panel.title} must use the provisioned data source`);
  const titles = dashboard.panels.filter((panel) => panel.type === 'row').map((panel) => panel.title).join('|');
  for (const area of ['Sao lưu', 'Hạ tầng', 'API', 'PostgreSQL']) assert.ok(titles.includes(area), `row for ${area}`);
  const expressions = panels.flatMap((panel) => panel.targets.map((target) => target.expr)).join('\n');
  for (const metric of ['c48_backup_last_success_timestamp_seconds', 'c48_sos_requests', 'c48_http_request_duration_seconds_bucket', 'pg_stat_activity_count']) {
    assert.ok(expressions.includes(metric), `dashboard must chart ${metric}`);
  }
});

test('nginx never routes /metrics to the Internet', () => {
  assert.match(read('nginx/nginx.conf'), /location = \/metrics \{\s*return 404;/u);
});

test('the Alertmanager and Grafana entrypoints refuse unsafe settings', () => {
  const run = (script, env) => spawnSync('sh', [join(infra, 'observability', script)], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  const badChat = run('alertmanager-entrypoint.sh', { TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: '12;rm -rf /' });
  assert.notEqual(badChat.status, 0);
  assert.match(badChat.stderr, /must be a number/u);
  const noPassword = run('grafana-entrypoint.sh', { GF_SECURITY_ADMIN_PASSWORD: '' });
  assert.notEqual(noPassword.status, 0);
  assert.match(noPassword.stderr, /refusing to start/u);
});

test('container-metrics lists long-running containers only and skips one-shot jobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'c48-metrics-'));
  try {
    const bin = join(root, 'docker');
    writeFileSync(bin, `#!/usr/bin/env bash
case "$1" in
  ps) printf 'id1\\nid2\\nid3\\n' ;;
  inspect) printf '/reliva-web 0 true false unless-stopped\\n/reliva-response-api 4 false true unless-stopped\\n/reliva-identity-migrate 0 false false no\\n' ;;
esac
`);
    chmodSync(bin, 0o755);
    const result = spawnSync('bash', [join(new URL('../deploy/container-metrics', import.meta.url).pathname)], {
      encoding: 'utf8', env: { PATH: process.env.PATH, C48_METRICS_DIR: join(root, 'm'), C48_DOCKER_BIN: bin },
    });
    assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(join(root, 'm/c48_container.prom'), 'utf8');
    assert.match(text, /^c48_container_restart_count\{name="reliva-response-api"\} 4$/mu);
    assert.match(text, /^c48_container_running\{name="reliva-response-api"\} 0$/mu);
    assert.match(text, /^c48_container_oom_killed\{name="reliva-response-api"\} 1$/mu);
    assert.match(text, /^c48_container_running\{name="reliva-web"\} 1$/mu);
    assert.doesNotMatch(text, /migrate/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
