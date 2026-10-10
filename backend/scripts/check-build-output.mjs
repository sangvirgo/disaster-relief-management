import { existsSync } from 'node:fs';

const missing = ['identity', 'response', 'logistics'].flatMap((service) => [
  `dist/apps/${service}/src/main.js`,
  `dist/apps/${service}/src/database/migrate.js`,
].filter((path) => !existsSync(path)));

if (missing.length) {
  process.stderr.write('Missing build entries: ' + missing.join(', ') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('All three service entry points and migrations are present.\n');
}
