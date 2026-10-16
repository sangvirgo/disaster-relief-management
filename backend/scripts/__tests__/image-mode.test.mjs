import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = new URL('../../../', import.meta.url).pathname;
const library = join(repositoryRoot, 'backend/scripts/dev/lib.sh');

function runComposeHelpers(imageSource) {
  const directory = mkdtempSync(join(tmpdir(), 'c48-image-mode-'));
  const log = join(directory, 'docker.log');
  const docker = join(directory, 'docker');
  writeFileSync(docker, '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$C48_DOCKER_LOG"\n');
  chmodSync(docker, 0o700);

  try {
    const result = spawnSync('bash', [
      '-c', 'source "$1"; main_compose_prepare_images identity-api; main_compose_up --profile storage -d nginx',
      'image-mode-test', library,
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        C48_IMAGE_SOURCE: imageSource,
        C48_DOCKER_LOG: log,
        PATH: `${directory}:${process.env.PATH}`,
      },
    });
    const output = result.status === 0 ? '' : `${result.stderr}\n${result.stdout}`;
    assert.equal(result.status, 0, output);
    return readFileSync(log, 'utf8').trim().split('\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('registry mode pulls the image and prevents Compose from building it', () => {
  const calls = runComposeHelpers('registry');
  assert.match(calls[0], /compose .* pull identity-api$/);
  assert.match(calls[1], /--profile storage up --no-build -d nginx$/);
});

test('local mode builds images and leaves Compose local-build behavior enabled', () => {
  const calls = runComposeHelpers('local');
  assert.match(calls[0], /compose .* build identity-api$/);
  assert.match(calls[1], /--profile storage up -d nginx$/);
  assert.doesNotMatch(calls[1], /--no-build/);
});
