import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nginx = readFileSync(new URL('../../infra/nginx/nginx.conf', import.meta.url), 'utf8');
const proxyCommon = readFileSync(new URL('../../infra/nginx/proxy-common.conf', import.meta.url), 'utf8');
const logisticsMain = readFileSync(new URL('../../apps/logistics/src/main.ts', import.meta.url), 'utf8');
const storageProxy = nginx.match(/location ~ \^\/c48-\(response\|logistics\)-evidence\/ \{([\s\S]*?)\n    \}/u)?.[1];
const donorDeliveryLocation = nginx.split('\n').find((line) =>
  line.includes('/api/v1/logistics/public/donation-drives/') && line.includes('/deliveries/'));
const donorDeliveryLimiter = donorDeliveryLocation?.match(/location\s+(~\*?)\s+/u)?.[1];
const donorEvidenceLocation = nginx.split('\n').find((line) =>
  line.includes('/api/v1/logistics/') && line.includes('/evidence'));
const donorEvidenceLimiter = donorEvidenceLocation?.match(/location\s+(~\*?)\s+/u)?.[1];

test('donor delivery rate limits match path case variants', () => {
  assert.equal(donorDeliveryLimiter, '~*');
});

test('donation evidence uploads keep size and concurrency limits on case variants', () => {
  assert.equal(donorEvidenceLimiter, '~*');
});

test('Logistics trusts only the forwarded Nginx hop for donor IP quotas', () => {
  assert.match(proxyCommon, /proxy_set_header X-Forwarded-For \$remote_addr;/u);
  assert.match(logisticsMain, /\.getHttpAdapter\(\)\.getInstance\(\)\.set\('trust proxy', 1\);/u);
});

test('presigned object downloads forward only the headers MinIO needs', () => {
  assert.ok(storageProxy, 'expected the private evidence proxy location');
  assert.match(storageProxy, /proxy_pass_request_headers off;/u);
  assert.match(storageProxy, /proxy_set_header Host \$http_host;/u);
  assert.match(storageProxy, /proxy_hide_header Cache-Control;/u);
  assert.match(storageProxy, /add_header Cache-Control no-store always;/u);
  assert.doesNotMatch(storageProxy, /proxy-common\.conf/u);
  for (const header of [
    'Authorization', 'Cookie', 'Origin', 'X-CSRF-Token', 'Idempotency-Key',
    'X-Tracking-Secret', 'X-Tracking-Code', 'X-Donation-Secret', 'X-Recovery-Code',
  ]) {
    assert.doesNotMatch(storageProxy, new RegExp(`proxy_set_header\\s+${header}\\b`, 'iu'));
  }
});
