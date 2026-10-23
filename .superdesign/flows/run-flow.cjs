const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [flowName, sourceDraftId] = process.argv.slice(2);
if (!flowName || !sourceDraftId) {
  throw new Error('Usage: node run-flow.cjs <flow-name> <source-draft-id>');
}

const pages = fs.readFileSync(path.join(__dirname, `${flowName}.json`), 'utf8');
JSON.parse(pages);

const cacheRoot = path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
const cliPath = fs.readdirSync(cacheRoot)
  .map((name) => path.join(cacheRoot, name, 'node_modules', '@superdesign', 'cli', 'bin', 'superdesign.js'))
  .find((candidate) => fs.existsSync(candidate));
if (!cliPath) throw new Error('Run npx --yes @superdesign/cli@latest before this script.');

const result = spawnSync(process.execPath, [
  cliPath,
  'execute-flow-pages',
  '--draft-id', sourceDraftId,
  '--pages', pages,
  '--context-file', '.superdesign/design-system.md',
  '--model', 'gemini-3.1-pro',
  '--json',
], { cwd: path.resolve(__dirname, '..', '..'), stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
