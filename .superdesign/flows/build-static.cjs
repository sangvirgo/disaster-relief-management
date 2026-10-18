const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const out = path.join(root, '.superdesign', 'tmp');
fs.mkdirSync(out, { recursive: true });
const css = fs.readFileSync(path.join(root, 'frontend', 'prototype', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'prototype', 'app.js'), 'utf8');
const nodes = new Map();
const document = {
  title: '',
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', addEventListener() {}, classList: { toggle() {} } });
    return nodes.get(id);
  },
  querySelectorAll() { return []; },
};
const context = vm.createContext({ document, location: { hash: '#citizen/home' }, window: { addEventListener() {} }, alert() {} });
vm.runInContext(app, context);
const routes = vm.runInContext('Object.entries(roles).flatMap(([role, data]) => data.items.map(([page]) => `${role}/${page}`))', context);
for (const route of routes) {
  context.location.hash = `#${route}`;
  vm.runInContext('render()', context);
  let n = 0;
  const screen = nodes.get('app').innerHTML
    .replace(/<a\s/g, () => `<a id="link-${++n}" `)
    .replace(/src="assets\/icons\/([a-z-]+)\.svg"/g, (_, icon) => {
      const svg = fs.readFileSync(path.join(root, 'frontend', 'prototype', 'assets', 'icons', `${icon}.svg`), 'utf8');
      return `src="data:image/svg+xml,${encodeURIComponent(svg)}"`;
    });
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${document.title}</title><style>${css}</style></head><body>${screen}</body></html>`;
  fs.writeFileSync(path.join(out, `${route.replace('/', '-')}.html`), html);
}
console.log(`${routes.length} static screen files written to ${out}`);
