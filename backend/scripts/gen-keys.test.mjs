import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import test from 'node:test';
import { generateKeys } from './gen-keys.mjs';

const generatedNames = [
  'POSTGRES_PASSWORD',
  'IDENTITY_MIGRATOR_PASSWORD', 'IDENTITY_APP_PASSWORD',
  'RESPONSE_MIGRATOR_PASSWORD', 'RESPONSE_APP_PASSWORD',
  'LOGISTICS_MIGRATOR_PASSWORD', 'LOGISTICS_APP_PASSWORD',
  'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'SERVICE_CLIENT_SECRET',
  'S3_RESPONSE_SECRET_KEY', 'S3_LOGISTICS_SECRET_KEY', 'MINIO_ROOT_PASSWORD',
  'SECRET_HASH_PEPPER_SOS', 'SECRET_HASH_PEPPER_DONATION',
];

test('generates an RS256 pair and local secrets once without changing unrelated values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'c48-gen-keys-'));
  const envPath = join(directory, '.env');
  const original = [
    'NODE_ENV=development',
    ...generatedNames.map((name) => `${name}=${name.includes('JWT_') ? 'base64-encoded-key' : 'replace-with-random-value'}`),
  ].join('\n') + '\n';

  try {
    await writeFile(envPath, original, { mode: 0o600 });
    await generateKeys(envPath);
    const first = await readFile(envPath, 'utf8');
    const values = new Map(first.trimEnd().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const privateKey = createPrivateKey(Buffer.from(values.get('JWT_PRIVATE_KEY'), 'base64'));
    const publicKey = createPublicKey(Buffer.from(values.get('JWT_PUBLIC_KEY'), 'base64'));
    const message = Buffer.from('C48 key-generation self-check');
    assert.equal(verify('RSA-SHA256', message, publicKey, sign('RSA-SHA256', message, privateKey)), true);
    assert.equal(values.get('NODE_ENV'), 'development');
    for (const name of generatedNames) assert.ok(!/^(replace-with-|base64-encoded-)/.test(values.get(name)));
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);

    assert.throws(() => generateKeys(envPath), /already contain generated secrets/);
    assert.equal(await readFile(envPath, 'utf8'), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
