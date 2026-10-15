import { lstatSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const privatePathMessage = 'MC_CONFIG_DIR and config.json must be private regular paths with no symlinks';

function inspectPathWithoutSymlinks(path) {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const segments = absolutePath.slice(root.length).split(sep).filter(Boolean);
  let currentPath = root;
  let stat;

  for (const [index, segment] of segments.entries()) {
    currentPath = join(currentPath, segment);
    stat = lstatSync(currentPath);
    if (stat.isSymbolicLink()) throw new Error(privatePathMessage);
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(privatePathMessage);
  }

  return { absolutePath, stat };
}

function isPrivate(mode) {
  return (mode & 0o077) === 0;
}

export function validateMcConfigDirectory(configDirectory) {
  if (typeof configDirectory !== 'string' || configDirectory.length === 0) {
    throw new Error(privatePathMessage);
  }

  try {
    const directory = inspectPathWithoutSymlinks(configDirectory);
    if (!directory.stat?.isDirectory() || !isPrivate(directory.stat.mode)) {
      throw new Error(privatePathMessage);
    }

    const config = inspectPathWithoutSymlinks(join(directory.absolutePath, 'config.json'));
    if (!config.stat?.isFile() || !isPrivate(config.stat.mode)) {
      throw new Error(privatePathMessage);
    }

    return config.absolutePath;
  } catch {
    throw new Error(privatePathMessage);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${validateMcConfigDirectory(process.argv[2])}\n`);
  } catch {
    process.stderr.write('mc configuration must be private, regular, and contain no symlinks\n');
    process.exitCode = 2;
  }
}
