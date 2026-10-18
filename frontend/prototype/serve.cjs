const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) && target !== path.join(root, 'index.html')) {
    response.writeHead(403); response.end(); return;
  }
  fs.readFile(target, (error, data) => {
    if (error) { response.writeHead(404); response.end('Không tìm thấy'); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
    response.end(data);
  });
});
const port = Number(process.env.C48_PROTOTYPE_PORT || 5179);
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
