import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve, sep, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const expectedBuckets = ['c48-response-evidence', 'c48-logistics-evidence'];

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function collectBucket(root, bucket, records) {
  const bucketRoot = join(root, bucket);
  const bucketInfo = await lstat(bucketRoot);
  if (!bucketInfo.isDirectory() || bucketInfo.isSymbolicLink()) throw new Error('invalid bucket directory');

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const objectPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('symbolic links are not valid objects');
      if (entry.isDirectory()) {
        await visit(objectPath);
        continue;
      }
      if (!entry.isFile()) throw new Error('unsupported object entry');

      const before = await lstat(objectPath);
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('invalid object file');
      const sha256 = await hashFile(objectPath);
      const after = await lstat(objectPath);
      if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
        throw new Error('object changed while inventory was generated');
      }
      records.push({
        bucket,
        key: relative(bucketRoot, objectPath).split(sep).join('/'),
        size_bytes: after.size,
        sha256,
      });
    }
  }

  await visit(bucketRoot);
}

export async function createObjectInventory(objectRoot) {
  const root = resolve(objectRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('invalid object root');

  const entries = await readdir(root, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (names.length !== expectedBuckets.length || expectedBuckets.some((bucket) => !names.includes(bucket))) {
    throw new Error('unexpected object buckets');
  }

  const records = [];
  for (const bucket of expectedBuckets) await collectBucket(root, bucket, records);
  return records;
}

async function main() {
  const [objectRoot, manifestPath] = process.argv.slice(2);
  if (!objectRoot || !manifestPath) throw new Error('object root and manifest path are required');
  const records = await createObjectInventory(objectRoot);
  const contents = records.map((record) => JSON.stringify(record)).join('\n');
  await writeFile(manifestPath, contents.length > 0 ? `${contents}\n` : '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await chmod(manifestPath, 0o600);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write('Object inventory generation failed.\n');
    process.exitCode = 1;
  });
}
