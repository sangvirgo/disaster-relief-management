import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nginx = readFileSync(new URL('../../infra/nginx/nginx.conf', import.meta.url), 'utf8');
const storageProxy = nginx.match(/location ~ \^\/c48-\(response\|logistics\)-evidence\/ \{([\s\S]*?)\n    \}/u)?.[1];

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
