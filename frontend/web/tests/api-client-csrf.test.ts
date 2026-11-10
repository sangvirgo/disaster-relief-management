import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, invalidateCsrf, upload } from '../src/api/client.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; invalidateCsrf(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

test('renews a rejected CSRF token once while retaining the command and idempotency key', async () => {
  invalidateCsrf();
  let tokens = 0;
  const commands: RequestInit[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/csrf')) return json({ csrf_token: `test-${++tokens}` });
    commands.push(init!);
    return commands.length === 1 ? json({ code: 'CSRF_INVALID' }, 403) : json({ status: 'CLOSED' });
  };
  assert.deepEqual(await api('response', '/campaigns/test/close', {
    method: 'POST', body: { expected_version: 3, reason: 'Test' }, idempotencyKey: 'same-command',
  }), { status: 'CLOSED' });
  assert.equal(tokens, 2);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].body, commands[1].body);
  assert.equal(new Headers(commands[0].headers).get('Idempotency-Key'), 'same-command');
  assert.equal(new Headers(commands[1].headers).get('Idempotency-Key'), 'same-command');
  assert.notEqual(new Headers(commands[0].headers).get('X-CSRF-Token'), new Headers(commands[1].headers).get('X-CSRF-Token'));
});

test('stops after one CSRF retry instead of looping', async () => {
  invalidateCsrf();
  let commands = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/csrf')) return json({ csrf_token: 'test' });
    commands++;
    return json({ code: 'CSRF_INVALID' }, 403);
  };
  await assert.rejects(api('response', '/campaigns/test/close', { method: 'POST', idempotencyKey: 'same' }),
    (error: unknown) => error instanceof ApiError && error.code === 'CSRF_INVALID');
  assert.equal(commands, 2);
});

test('does not replay forbidden commands or uncertain network failures', async () => {
  for (const networkFailure of [false, true]) {
    invalidateCsrf();
    let commands = 0;
    globalThis.fetch = async url => {
      if (String(url).endsWith('/auth/csrf')) return json({ csrf_token: 'test' });
      commands++;
      if (networkFailure) throw new TypeError('Network unavailable');
      return json({ code: 'FORBIDDEN' }, 403);
    };
    await assert.rejects(api('response', '/campaigns/test/close', { method: 'POST', idempotencyKey: 'same' }));
    assert.equal(commands, 1);
  }
});

test('does not attach session credentials or renew CSRF for anonymous requests', async () => {
  invalidateCsrf();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).has('X-CSRF-Token'), false);
    return json({ code: 'CSRF_INVALID' }, 403);
  };
  await assert.rejects(api('response', '/requests', { method: 'POST', credentials: 'omit' }));
  assert.equal(calls, 1);
});

test('retries an upload with the same file and idempotency key', async () => {
  invalidateCsrf();
  let uploads = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/csrf')) return json({ csrf_token: 'test' });
    uploads++;
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'upload-command');
    const file = (init?.body as FormData).get('file') as File;
    assert.equal(file.name, 'test.txt');
    assert.equal(await file.text(), 'test-only');
    return uploads === 1 ? json({ code: 'CSRF_INVALID' }, 403) : json({ state: 'READY' });
  };
  assert.deepEqual(await upload('response', '/requests/test/evidence', new File(['test-only'], 'test.txt'), {
    idempotencyKey: 'upload-command',
  }), { state: 'READY' });
  assert.equal(uploads, 2);
});
