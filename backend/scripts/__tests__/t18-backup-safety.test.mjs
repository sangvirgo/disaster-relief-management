import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertMinioAliasMatchesComposeEndpoint } from '../db/verify-minio-endpoint.mjs';
import { createObjectInventory } from '../db/object-inventory.mjs';
import { validateMcConfigDirectory } from '../db/validate-mc-config.mjs';

test('mc configuration accepts a private directory and regular private config file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c48-t18-mc-config-'));
  const configDirectory = join(root, 'private-mc');
  try {
    await mkdir(configDirectory, { mode: 0o700 });
    await chmod(configDirectory, 0o700);
    await writeFile(join(configDirectory, 'config.json'), '{"aliases":{}}', { mode: 0o600 });
    await chmod(join(configDirectory, 'config.json'), 0o600);

    assert.equal(validateMcConfigDirectory(configDirectory), join(configDirectory, 'config.json'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mc configuration rejects a directory accessible by group or other users', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c48-t18-mc-config-'));
  const configDirectory = join(root, 'loose-mc');
  try {
    await mkdir(configDirectory, { mode: 0o750 });
    await chmod(configDirectory, 0o750);
    await writeFile(join(configDirectory, 'config.json'), '{}', { mode: 0o600 });

    assert.throws(() => validateMcConfigDirectory(configDirectory), /private/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mc configuration rejects a config file accessible by group or other users', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c48-t18-mc-config-'));
  const configDirectory = join(root, 'private-mc');
  try {
    await mkdir(configDirectory, { mode: 0o700 });
    await chmod(configDirectory, 0o700);
    await writeFile(join(configDirectory, 'config.json'), '{}', { mode: 0o640 });
    await chmod(join(configDirectory, 'config.json'), 0o640);

    assert.throws(() => validateMcConfigDirectory(configDirectory), /private/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mc configuration rejects a symlinked directory or config file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c48-t18-mc-config-'));
  const realDirectory = join(root, 'real-mc');
  const linkedDirectory = join(root, 'linked-mc');
  try {
    await mkdir(realDirectory, { mode: 0o700 });
    await chmod(realDirectory, 0o700);
    await writeFile(join(realDirectory, 'config.json'), '{}', { mode: 0o600 });
    await chmod(join(realDirectory, 'config.json'), 0o600);
    await symlink(realDirectory, linkedDirectory, 'dir');
    await symlink(join(realDirectory, 'config.json'), join(realDirectory, 'config-link.json'));

    assert.throws(() => validateMcConfigDirectory(linkedDirectory), /private/u);
    await rm(join(realDirectory, 'config.json'));
    await symlink(join(realDirectory, 'config-link.json'), join(realDirectory, 'config.json'));
    assert.throws(() => validateMcConfigDirectory(realDirectory), /private/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mc configuration rejects a non-regular config.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c48-t18-mc-config-'));
  const configDirectory = join(root, 'private-mc');
  try {
    await mkdir(configDirectory, { mode: 0o700 });
    await chmod(configDirectory, 0o700);
    await mkdir(join(configDirectory, 'config.json'), { mode: 0o700 });

    assert.throws(() => validateMcConfigDirectory(configDirectory), /private/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('MinIO backup alias uses only the main service loopback S3 port, never public ingress', () => {
  const compose = JSON.stringify({ services: {
    'response-api': { environment: { S3_PUBLIC_ENDPOINT: 'http://localhost:8080' } },
    minio: { ports: [{ host_ip: '127.0.0.1', target: 9000, published: '59000', protocol: 'tcp' }] },
  } });
  const alias = (url) => JSON.stringify({ aliases: { primary: { url } } });
  assert.doesNotThrow(() => assertMinioAliasMatchesComposeEndpoint(compose, alias('http://127.0.0.1:59000'), 'primary'));
  for (const url of ['http://localhost:8080', 'http://minio:9000', 'http://127.0.0.1:9001', 'http://127.0.0.1:59000/bucket']) {
    assert.throws(() => assertMinioAliasMatchesComposeEndpoint(compose, alias(url), 'primary'));
  }
  assert.throws(() => assertMinioAliasMatchesComposeEndpoint(compose.replace('127.0.0.1', '0.0.0.0'), alias('http://0.0.0.0:59000'), 'primary'));
  assert.throws(() => assertMinioAliasMatchesComposeEndpoint(compose, compose, 'missing'));
});

test('object inventory records each bucket key, byte size, and streamed SHA-256', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c48-t18-object-inventory-'));
  const responseBucket = join(root, 'c48-response-evidence');
  const logisticsBucket = join(root, 'c48-logistics-evidence');
  const key = 'nested/evidence.bin';
  const content = Buffer.from('fixture evidence bytes');
  try {
    await mkdir(join(responseBucket, 'nested'), { recursive: true });
    await mkdir(logisticsBucket, { recursive: true });
    await writeFile(join(responseBucket, key), content);

    assert.deepEqual(await createObjectInventory(root), [{
      bucket: 'c48-response-evidence',
      key,
      size_bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
