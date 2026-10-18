const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const cacheRoot = path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
const cliPath = fs.readdirSync(cacheRoot)
  .map((name) => path.join(cacheRoot, name, 'node_modules', '@superdesign', 'cli', 'bin', 'superdesign.js'))
  .find((candidate) => fs.existsSync(candidate));
if (!cliPath) throw new Error('Superdesign CLI cache unavailable. Run npx --yes @superdesign/cli@latest first.');

const projectId = '44bcd4b9-88e7-4731-a0fb-833c655183c9';
const existing = {
  'citizen-home': { draftId: '8a1d94cf-9a35-4569-8303-3b2a3c2b0003' },
  'citizen-sos': { draftId: '0b44bd0c-a5ef-40b7-9419-8ac7a62068de' },
  'citizen-track': { draftId: '409a36d3-9721-4f77-b4ba-84a67dcc5790' },
  'citizen-campaigns': { draftId: '93ffa88a-ea9c-4dc5-a764-52781588622d' },
  'citizen-drives': { draftId: '0d6cafa9-adc7-4799-a0df-98e71eda9cb6' },
  'citizen-declare': { draftId: '4a2fa7aa-25df-400e-b0a8-76680ce72fbf' },
  'citizen-donation': { draftId: '4693a2c6-abbb-4dbc-bc7f-da39ca40e9ec' },
  'coordinator-queue': { draftId: '947aa3ad-53a8-4682-80de-594eeefcf01c' },
};
const manifestPath = path.join(root, '.superdesign', 'flows', 'imported.json');
const manifest = { ...existing, ...(fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {}) };
const files = fs.readdirSync(path.join(root, '.superdesign', 'tmp'))
  .filter((name) => /^(citizen|volunteer|coordinator|operations|admin)-.+\.html$/.test(name));
for (const file of files) {
  const route = file.replace(/\.html$/, '');
  if (manifest[route] && !process.argv.includes('--sync')) continue;
  const htmlPath = path.join(root, '.superdesign', 'tmp', file);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const title = html.match(/<title>(.*?)<\/title>/)?.[1]?.replace(' — C48 Web', '') || route;
  const destination = manifest[route]
    ? ['--into', manifest[route].draftId]
    : ['--project-id', projectId, '--title', title, '--device', 'desktop'];
  const result = spawnSync(process.execPath, [cliPath, 'import-design-draft',
    ...destination, '--html-file', htmlPath,
    '--user-request', 'Thiết kế đủ các màn hình Web responsive cho năm actor dựa trên backend và Figma', '--json',
  ], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`${route}: ${result.stdout || result.stderr}`);
    process.exit(result.status || 1);
  }
  const entry = JSON.parse(result.stdout);
  manifest[route] = entry;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`${route}: ${entry.draftId}`);
}
console.log(`Imported or retained ${Object.keys(manifest).length} static screens.`);
