import { chmodSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const names = [
  'POSTGRES_PASSWORD',
  'IDENTITY_MIGRATOR_PASSWORD', 'IDENTITY_APP_PASSWORD',
  'RESPONSE_MIGRATOR_PASSWORD', 'RESPONSE_APP_PASSWORD',
  'LOGISTICS_MIGRATOR_PASSWORD', 'LOGISTICS_APP_PASSWORD',
  'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'SERVICE_CLIENT_SECRET',
  'S3_RESPONSE_SECRET_KEY', 'S3_LOGISTICS_SECRET_KEY', 'MINIO_ROOT_PASSWORD',
  'SECRET_HASH_PEPPER_SOS', 'SECRET_HASH_PEPPER_DONATION',
];

export function generateKeys(envPath) {
  const path = resolve(envPath);
  if (lstatSync(path).isSymbolicLink()) throw new Error('Refusing to replace a symbolic-link .env file');
  const original = readFileSync(path, 'utf8');
  const lines = original.split(/\r?\n/);

  for (const name of names) {
    const matches = lines.filter((line) => line.startsWith(name + '='));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${name} entry in .env`);
    const value = matches[0].slice(name.length + 1);
    if (!/^(?:replace-with-|base64-encoded-)/.test(value)) {
      throw new Error('.env already contain generated secrets; refusing to rotate keys');
    }
  }

  const pair = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicExponent: 0x10001,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const generated = new Map(names.map((name) => [name, randomBytes(32).toString('hex')]));
  generated.set('JWT_PRIVATE_KEY', Buffer.from(pair.privateKey).toString('base64'));
  generated.set('JWT_PUBLIC_KEY', Buffer.from(pair.publicKey).toString('base64'));

  const output = lines.map((line) => {
    const separator = line.indexOf('=');
    const value = generated.get(line.slice(0, separator));
    return value ? `${line.slice(0, separator + 1)}${value}` : line;
  }).join('\n');
  const tempDir = mkdtempSync(join(dirname(path), '.c48-keys-'));
  const tempPath = join(tempDir, '.env');
  try {
    writeFileSync(tempPath, output, { mode: 0o600, flag: 'wx' });
    renameSync(tempPath, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    generateKeys(resolve(dirname(fileURLToPath(import.meta.url)), '../.env'));
    process.stdout.write('Generated an RS256 key pair and local secrets in backend/.env.\n');
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : 'Key generation failed') + '\n');
    process.exitCode = 1;
  }
}
