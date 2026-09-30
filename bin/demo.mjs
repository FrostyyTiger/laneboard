#!/usr/bin/env node
// laneboard's demo: the real frontend, fed by a simulated lab instead of a
// server. Nothing is installed, nothing runs, no tmux and no Claude Code.
//
//   npm run demo                      build into site/ and serve it on :7780
//   node bin/demo.mjs --build         build only (what the Pages workflow runs)
//   node bin/demo.mjs --out dir --port 8080
//
// The build copies public/ untouched, adds the vendored xterm files, and puts
// demo/world.js + demo/engine.js in front of app.js. The engine replaces the
// socket and /api with the simulation before app.js runs, so the page under
// test is byte for byte the page a real install serves.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { VENDOR } from '../server/vendor.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = path.resolve(opt('--out', path.join(ROOT, 'site')));
const PORT = Number(opt('--port', 7780));

export function build(out = OUT) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'public'), out, { recursive: true });
  // No push, no install prompt: a demo page must not register a worker that
  // outlives it on someone else's origin.
  fs.rmSync(path.join(out, 'sw.js'), { force: true });
  fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
  for (const [name, rel] of Object.entries(VENDOR)) {
    fs.copyFileSync(path.join(ROOT, 'node_modules', rel), path.join(out, 'vendor', name));
  }
  fs.cpSync(path.join(ROOT, 'demo'), path.join(out, 'demo'), { recursive: true });

  const indexPath = path.join(out, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const tag = '<script type="module" src="app.js"></script>';
  if (!html.includes(tag)) throw new Error(`demo build: index.html no longer loads app.js as ${tag}`);
  const boot = '<script src="demo/world.js"></script>\n<script src="demo/engine.js"></script>\n';
  fs.writeFileSync(indexPath, html
    .replace('<title>laneboard</title>', '<title>laneboard · demo</title>')
    .replace(tag, boot + tag));
  // GitHub Pages runs Jekyll unless told not to.
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function serve(dir, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) && file !== dir) { res.writeHead(403).end(); return; }
    fs.readFile(fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dir, 'index.html'), (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      const type = TYPES[path.extname(file)] ?? (rel.endsWith('/') || !path.extname(file) ? TYPES['.html'] : 'application/octet-stream');
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
    });
  });
  // Loopback only, like laneboard itself.
  server.listen(port, '127.0.0.1', () => process.stdout.write(`laneboard demo on http://127.0.0.1:${port}/\n`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = build();
  process.stdout.write(`built ${path.relative(process.cwd(), out) || '.'}\n`);
  if (!args.includes('--build')) serve(out, PORT);
}
