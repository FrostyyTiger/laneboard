#!/usr/bin/env node
// Screenshots of a running laneboard, for rounds that change the UI (no dependencies: headless
// Chromium over the DevTools protocol). The loop owns this file (fenced); rounds only run it.
//
//   node docs/plans/cockpit/loop-build/shoot.mjs --url http://127.0.0.1:7795 --out <dir> \
//     [--views map,runs,board,inbox] [--themes dark,light] [--widths 1440,390] [--wait 4000] [--hash '#/map?x=1']
//
// Writes <dir>/<view>-<theme>-<width>.png and <dir>/console.txt (page errors and console errors,
// one per line, with the shot they came from). Exit 0 even when the page logged errors: read
// console.txt. Chrome: $CHROME, else the newest ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://127.0.0.1:7795').replace(/\/$/, '');
const out = arg('out'); if (!out) { console.error('--out <dir> is required'); process.exit(2); }
const views = arg('views', 'map,runs,board,inbox').split(',');
const themes = arg('themes', 'dark,light').split(',');
const widths = arg('widths', '1440').split(',').map(Number);
const wait = Number(arg('wait', '4000'));
const hash = arg('hash');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) { console.error('--url must be a loopback http URL'); process.exit(2); }

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), '.cache/ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort() : [];
  for (const d of dirs.reverse()) { const p = path.join(base, d, 'chrome-linux/chrome'); if (fs.existsSync(p)) return p; }
  console.error('no Chromium found (set CHROME)'); process.exit(2);
}

fs.mkdirSync(out, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-'));
const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  '--no-first-run', '--hide-scrollbars', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { try { chrome.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} process.exit(code); };
setTimeout(() => { console.error('shoot: timed out'); done(1); }, 10 * 60 * 1000).unref();

let ok = false;
for (let i = 0; i < 75 && !ok; i++) { try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ok = true; } catch { await sleep(200); } }
if (!ok) { console.error('Chromium did not start'); done(1); }
const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const logs = []; let current = '';
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push(`${current}\tpageerror\t${m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text}`);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(m.params.type))
    logs.push(`${current}\tconsole.${m.params.type}\t${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');

for (const width of widths) {
  const mobile = width < 600;
  await send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 3 : 2, mobile });
  for (const theme of themes) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    for (const view of hash ? ['custom'] : views) {
      current = `${view}-${theme}-${width}`;
      await send('Page.navigate', { url: `${url}/${hash || `#/${view}`}` });
      await sleep(1500);
      await send('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme','${theme}'); try{localStorage.setItem('theme','${theme}')}catch(e){}` });
      await sleep(wait);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, `${current}.png`), Buffer.from(shot.data, 'base64'));
      console.log(path.join(out, `${current}.png`));
    }
  }
}
fs.writeFileSync(path.join(out, 'console.txt'), logs.join('\n') + (logs.length ? '\n' : ''));
console.log(`${logs.length} console/page errors -> ${path.join(out, 'console.txt')}`);
ws.close(); done(0);
