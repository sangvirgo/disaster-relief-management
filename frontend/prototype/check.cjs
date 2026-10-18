const fs = require('node:fs');
const vm = require('node:vm');

const nodes = new Map();
const document = {
  title: '',
  getElementById(id) {
    if (!nodes.has(id))
      nodes.set(id, { innerHTML: '', addEventListener() {}, classList: { toggle() {} } });
    return nodes.get(id);
  },
  querySelectorAll() {
    return [];
  },
};
const context = vm.createContext({
  document,
  location: { hash: '#citizen/home' },
  window: { addEventListener() {} },
  alert() {},
});
vm.runInContext(fs.readFileSync(require.resolve('./app.js'), 'utf8'), context);
const routes = vm.runInContext(
  'Object.entries(roles).flatMap(([role, data]) => data.items.map(([page]) => `${role}/${page}`))',
  context,
);
for (const route of routes) {
  context.location.hash = `#${route}`;
  vm.runInContext('render()', context);
  const output = nodes.get('app').innerHTML;
  if (
    !output.includes('<main class="content">') ||
    output.includes('undefined') ||
    output.includes('NaN')
  ) {
    throw new Error(`Invalid render: ${route}`);
  }
  for (const [, icon] of output.matchAll(/src="assets\/icons\/([a-z-]+)\.svg"/g)) {
    if (!fs.existsSync(require('node:path').join(__dirname, 'assets', 'icons', `${icon}.svg`))) {
      throw new Error(`Missing navigation image ${icon} on ${route}`);
    }
  }
}
console.log(`${routes.length} màn hình dựng thành công`);
