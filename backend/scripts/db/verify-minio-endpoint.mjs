import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseConfig(source) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('configuration could not be parsed');
  }
}

function normalizeEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error('endpoint is missing or invalid');
  }

  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('endpoint is missing or invalid');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('endpoint is missing or invalid');
  }
  return endpoint.href;
}

export function assertMinioAliasMatchesComposeEndpoint(composeConfigText, aliasConfigText, alias) {
  const compose = parseConfig(composeConfigText);
  const mc = parseConfig(aliasConfigText);
  const primaryEndpoint = compose.services?.['response-api']?.environment?.S3_PUBLIC_ENDPOINT;
  const aliasEndpoint = mc.aliases?.[alias]?.url;
  if (typeof primaryEndpoint !== 'string' || typeof aliasEndpoint !== 'string') {
    throw new Error('primary endpoint or selected alias URL is missing');
  }
  if (normalizeEndpoint(primaryEndpoint) !== normalizeEndpoint(aliasEndpoint)) {
    throw new Error('MinIO alias and primary S3_PUBLIC_ENDPOINT endpoints do not match');
  }
}

async function readStdin() {
  let content = '';
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

async function main() {
  const [aliasConfigPath, alias] = process.argv.slice(2);
  if (!aliasConfigPath || !alias) throw new Error('alias configuration and name are required');
  const [composeConfigText, aliasConfigText] = await Promise.all([
    readStdin(),
    readFile(aliasConfigPath, 'utf8'),
  ]);
  assertMinioAliasMatchesComposeEndpoint(composeConfigText, aliasConfigText, alias);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write('MinIO alias endpoint verification failed.\n');
    process.exitCode = 1;
  });
}
