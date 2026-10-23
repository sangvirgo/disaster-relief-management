const fs = require('node:fs');
const path = require('node:path');

// Small, task-specific illustrations for the navigation. These are image assets,
// not characters from an icon font or a third-party icon pack.
const artwork = {
  home: '<path d="M3.5 11 12 4l8.5 7v8.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V11Z"/><path d="M9 20.5v-6h6v6"/><path d="M5.5 9.3V5.8h3"/>',
  account: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20v-2.2c0-3 2.8-5.2 6.5-5.2s6.5 2.2 6.5 5.2V20"/><path d="M9 18h6"/>',
  sos: '<path d="M5 4.8h14a2 2 0 0 1 2 2v9.1a2 2 0 0 1-2 2h-7l-5.7 3v-3H5a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2Z"/><path d="M12 8v4.5"/><circle cx="12" cy="15" r=".7" fill="#47758A" stroke="none"/>',
  receipt: '<path d="M6 3.5h9l3 3V21l-3-1.5-3 1.5-3-1.5L6 21V3.5Z"/><path d="M14.8 3.7v3h3"/><path d="m9 13 2 2 4-4"/>',
  track: '<path d="M12 21s6.4-6.2 6.4-11.3a6.4 6.4 0 1 0-12.8 0C5.6 14.8 12 21 12 21Z"/><circle cx="12" cy="9.7" r="2.2"/><path d="M3 21h6m6 0h6"/>',
  campaign: '<path d="M5 20V4m0 1h11.5l-2 3.8 2 3.7H5"/><path d="M3 20h5"/><path d="M20 5.5v2M19 6.5h2"/>',
  drive: '<path d="M3.5 9.5 12 5l8.5 4.5V19L12 22l-8.5-3V9.5Z"/><path d="M3.5 9.5 12 13l8.5-3.5M12 13v9"/><path d="M9.3 6.5 17.7 11"/>',
  declare: '<path d="M4 15.5c2-2 4-2 6 0l1.7 1.4c.7.5 1.8.4 2.3-.3.5-.7.3-1.5-.3-2l-3.6-2.7c-1.2-.9-3-.8-4.1.2L3 14.6"/><path d="M20 15.5c-2-2-4-2-6 0M7 19c3 2.2 7 2.2 10 0l4-4.4"/><path d="M9 5.5h6v5H9zM12 5.5V3"/>',
  donation: '<path d="M4 5.5h16v14H4z"/><path d="M4 9h16M8 5.5v3.5M16 5.5v3.5"/><path d="m8.7 14.5 2.1 2.1 4.5-4.5"/>',
  mission: '<path d="M4 18.5 9 5l3 7 3-7 5 13.5H4Z"/><path d="M9 17.8h6M12 12v5.8"/>',
  progress: '<path d="M4 19.5h16M5 16l4-4 3 2 6-7"/><path d="M14.5 7H18v3.5"/><circle cx="5" cy="16" r="1.1" fill="#D7E7EF"/>',
  team: '<circle cx="9" cy="8" r="2.4"/><circle cx="16.5" cy="9" r="2"/><path d="M3.5 19v-1.4c0-2.6 2.3-4.4 5.5-4.4s5.5 1.8 5.5 4.4V19h-11ZM15 14c2.8 0 5 1.6 5 4v1h-3"/>',
  notice: '<path d="M6 17h12l-1.5-2.2V9.5a4.5 4.5 0 0 0-9 0v5.3L6 17Z"/><path d="M10 20h4M12 3v2"/><circle cx="18.5" cy="5.5" r="2.2" fill="#D7E7EF"/>',
  queue: '<path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12.5h8M8 16h5"/><path d="M3 7v10"/>',
  verify: '<path d="M12 3 4.5 6v5.6c0 4.2 2.6 7.7 7.5 9.4 4.9-1.7 7.5-5.2 7.5-9.4V6L12 3Z"/><path d="m8.5 12 2.3 2.3 4.8-4.8"/>',
  priority: '<path d="m12 3 9 16H3l9-16Z"/><path d="M12 9v4.5"/><circle cx="12" cy="16" r=".7" fill="#47758A" stroke="none"/>',
  assign: '<circle cx="8" cy="7" r="2.5"/><path d="M3.5 18v-1.4c0-2.5 1.8-4 4.5-4s4.5 1.5 4.5 4V18h-9Z"/><path d="M14 8h7m-3.5-3.5L21 8l-3.5 3.5M14.5 17h6"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/><circle cx="13" cy="11" r="2" fill="#D7E7EF"/>',
  report: '<path d="M5 4h14v16H5z"/><path d="M8 16v-3m4 3V9m4 7v-5M8 7h4"/>',
  intake: '<path d="M3.5 8.5 12 4l8.5 4.5V19L12 22l-8.5-3V8.5Z"/><path d="M3.5 8.5 12 12l8.5-3.5M12 12v10"/><path d="M9 16h6M12 13v6"/>',
  review: '<path d="M7 4.5h10v16H7zM10 3.5h4v2h-4z"/><path d="m9.5 13 2 2 4-4"/><path d="M10 18h4"/>',
  stock: '<path d="M3.5 8 12 4l8.5 4v11L12 22l-8.5-3V8Z"/><path d="M3.5 8 12 12l8.5-4M12 12v10M7 10l8.5-4"/>',
  assets: '<path d="M3 7h11v9H3zM14 10h3l4 4v2h-7v-6Z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M5 4h7"/>',
  needs: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h4M8 16h3"/><circle cx="17" cy="16" r="2" fill="#D7E7EF"/>',
  distribution: '<path d="M4 12h12m-3.5-3.5L16 12l-3.5 3.5"/><path d="M4 6h7M4 18h7M18 6h2v12h-2"/>',
  handoff: '<path d="M3.5 8h10m-3-3 3 3-3 3M20.5 16h-10m3-3-3 3 3 3"/><path d="M3.5 15h4m9-6h4"/>',
  users: '<circle cx="9" cy="8" r="2.4"/><circle cx="17" cy="8" r="2.4"/><path d="M3.5 19v-1.4c0-2.4 2.2-4 5.5-4s5.5 1.6 5.5 4V19h-11ZM15 14c3 0 5.5 1.5 5.5 3.8V19H17"/>',
  organization: '<path d="M5 20V5h14v15M3 20h18M9 8h2m3 0h2M9 12h2m3 0h2M10 20v-4h4v4"/>',
  grants: '<path d="M12 3 5 6v6c0 4 2.3 7 7 9 4.7-2 7-5 7-9V6l-7-3Z"/><circle cx="12" cy="10" r="2"/><path d="M8.7 16c.3-1.6 1.5-2.5 3.3-2.5s3 .9 3.3 2.5"/>',
  regions: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/><path d="m12 10 1.5 1.5-1.5 1.5-1.5-1.5L12 10Z" fill="#D7E7EF"/>',
  audit: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 11.5h8M8 15h4"/><circle cx="16.5" cy="16.5" r="2.5" fill="#D7E7EF"/><path d="m18.3 18.3 2.2 2.2"/>',
};

const target = path.join(__dirname, 'assets', 'icons');
fs.mkdirSync(target, { recursive: true });
const mint = new Set(['campaign', 'drive', 'declare', 'donation', 'team', 'progress', 'stock', 'assets', 'needs', 'distribution', 'handoff']);
const warm = new Set(['sos', 'priority', 'notice', 'mission', 'intake', 'review', 'verify', 'assign']);
for (const [name, shapes] of Object.entries(artwork)) {
  const base = warm.has(name) ? '#F8EEE6' : mint.has(name) ? '#E5F1EC' : '#E2EEF5';
  const accent = warm.has(name) ? '#E9CBB7' : mint.has(name) ? '#B7DCD0' : '#B3D4E3';
  const backdrop = `<path d="M5.1 5.7C8.4 2.3 15.4 2.3 19.1 6.2c3.5 3.7 2.6 10.5-1.7 13.3-4.5 2.9-11.3 1.6-13.4-2.9C2.1 13.5 2.1 8.8 5.1 5.7Z" fill="${base}" stroke="none"/><circle cx="18.4" cy="5.6" r="2" fill="${accent}" stroke="none"/>`;
  const coloredShapes = shapes.replaceAll('#D7E7EF', accent).replaceAll('#47758A', '#365F74');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#365F74" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${name}">${backdrop}${coloredShapes}</svg>`;
  fs.writeFileSync(path.join(target, `${name}.svg`), svg);
}
console.log(`${Object.keys(artwork).length} icon images written to ${target}`);
