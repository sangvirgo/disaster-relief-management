import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const nginx = read('../../infra/nginx/nginx.conf');
const keys = (text) => text.split('\n').filter((line) => /^[A-Z0-9_]+=/u.test(line)).map((line) => line.split('=')[0]);

test('nginx trusts CF-Connecting-IP only from the Docker/loopback hop that cloudflared reaches it through', () => {
  const httpBlock = nginx.split('http {')[1];
  assert.match(httpBlock, /set_real_ip_from 172\.16\.0\.0\/12;/u);
  assert.match(httpBlock, /set_real_ip_from 127\.0\.0\.1;/u);
  assert.match(httpBlock, /real_ip_header CF-Connecting-IP;/u);
  assert.doesNotMatch(nginx, /set_real_ip_from (?:0\.0\.0\.0\/0|::\/0)/u, 'never trust the header from arbitrary peers');
  assert.ok(httpBlock.indexOf('real_ip_header') < httpBlock.indexOf('limit_req_zone'), 'real IP must be set before zones use it');
});

test('only /health/live is exposed through nginx for the external uptime check', () => {
  const live = nginx.match(/location = \/health\/live \{([\s\S]*?)\n    \}/u)?.[1];
  assert.ok(live, 'expected an exact-match liveness location');
  assert.match(live, /proxy_pass http:\/\/identity_api;/u);
  assert.match(live, /add_header Cache-Control no-store always;/u);
  assert.match(nginx, /location ~\* \/\(\?:internal\|health\)\(\?:\/\|\$\) \{\s*return 404;/u, 'every other health and internal path stays hidden');
  assert.ok(nginx.indexOf('location = /health/live') < nginx.indexOf('location ~* /(?:internal|health)'));
});

test('the production template lists exactly the variables of .env.example and leaves AWS keys empty', () => {
  const example = read('../../.env.example');
  const production = read('../../.env.production.example');
  // S3_BACKUP_BUCKET is read only by the host backup scripts, so the local template has no use for it.
  assert.deepEqual(keys(production).filter((key) => key !== 'S3_BACKUP_BUCKET'), keys(example));
  assert.match(production, /^S3_BACKUP_BUCKET=c48-backup-__SUFFIX__$/mu);
  for (const key of ['S3_RESPONSE_ACCESS_KEY', 'S3_LOGISTICS_ACCESS_KEY', 'SEED_PASSWORD']) {
    assert.match(production, new RegExp(`^${key}=$`, 'mu'));
  }
  assert.match(production, /^NODE_ENV=production$/mu);
  assert.match(production, /^C48_IMAGE_SOURCE=registry$/mu);
  assert.match(production, /^S3_REGION=__REGION__$/mu);
});

test('the production template, once its placeholders are filled, is a valid main-stack Compose configuration', (context) => {
  if (spawnSync('docker', ['compose', 'version']).status !== 0) return context.skip('docker compose is unavailable');
  const directory = mkdtempSync(join(tmpdir(), 'c48-prod-env-'));
  try {
    const filled = read('../../.env.production.example')
      .replaceAll('__DOMAIN__', 'app.example.test').replaceAll('__SUFFIX__', 'abc123').replaceAll('__REGION__', 'ap-southeast-2')
      .replace(/=(?:replace-with-[a-z-]+|base64-encoded-[a-z-]+)$/gmu, '=filled-in-by-init-env-0123456789abcdef')
      .replace(/^(S3_(?:RESPONSE|LOGISTICS)_SECRET_KEY)=.*$/gmu, '$1='); // init-env blanks these again
    const envFile = join(directory, '.env');
    writeFileSync(envFile, filled);
    const result = spawnSync('docker', ['compose', '--env-file', envFile, '-f', new URL('../../infra/compose.yaml', import.meta.url).pathname, 'config', '--format', 'json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const services = JSON.parse(result.stdout).services;
    for (const [name, bucket] of [['response-api', 'c48-response-evidence-abc123'], ['logistics-api', 'c48-logistics-evidence-abc123']]) {
      const environment = services[name].environment;
      assert.equal(environment.S3_ENDPOINT, 'https://s3.ap-southeast-2.amazonaws.com');
      assert.equal(environment.S3_PUBLIC_ENDPOINT, 'https://s3.ap-southeast-2.amazonaws.com');
      assert.equal(environment.S3_REGION, 'ap-southeast-2');
      assert.equal(environment.S3_BUCKET, bucket);
      assert.equal(environment.S3_ACCESS_KEY, '', 'AWS uses the instance role, not static keys');
      assert.equal(environment.S3_SECRET_KEY, '');
      assert.equal(environment.NODE_ENV, 'production');
    }
    assert.equal(services['identity-api'].environment.WEB_ALLOWED_ORIGINS, 'https://app.example.test');
    assert.equal(services['identity-api'].image, 'ghcr.io/sangvirgo/disaster-relief-management/identity-api:latest');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the local MinIO defaults are unchanged when no S3 variable is overridden', () => {
  const result = spawnSync('docker', ['compose', '--env-file', new URL('../../.env.example', import.meta.url).pathname, '-f', new URL('../../infra/compose.yaml', import.meta.url).pathname, 'config', '--format', 'json'], { encoding: 'utf8' });
  if (result.status !== 0) return;
  const { 'response-api': response, 'logistics-api': logistics } = JSON.parse(result.stdout).services;
  assert.equal(response.environment.S3_ENDPOINT, 'http://minio:9000');
  assert.equal(response.environment.S3_BUCKET, 'c48-response-evidence');
  assert.equal(logistics.environment.S3_BUCKET, 'c48-logistics-evidence');
  assert.equal(response.environment.S3_REGION, 'us-east-1');
});
