#!/usr/bin/env node
// A filmstrip of a moving page: frames over time on one contact sheet, plus the frame rate, under a
// CPU throttle that stands in for a small tablet. Motion cannot be judged from one screenshot; this is
// what the reviewers look at. No dependencies: headless Chromium over the DevTools protocol, like
// shoot.mjs. The loop owns this file (fenced); rounds only run it.
//
//   node docs/plans/wall/loop/film.mjs --url 'http://127.0.0.1:7795/wall.html?variant=radial&demo=1' \
//     --out <dir> [--frames 12] [--every 2500] [--warmup 4000] [--width 1368] [--height 912] [--cpu 4]
//
// Writes <dir>/frame-NN.jpg, <dir>/sheet.png (all frames, 4 per row, each with its time), <dir>/perf.json
// ({fps, worstGapMs, frames, seconds, cpuThrottle, source}) and <dir>/console.txt. fps comes from the
// page's window.__wallPerf = {frames, worstGapMs} when it exists, else from requestAnimationFrame.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url');
const out = arg('out');
if (!url || !out) { console.error('--url and --out are required'); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) { console.error('--url must be a loopback http URL'); process.exit(2); }
const FRAMES = Number(arg('frames', '12'));
const EVERY = Number(arg('every', '2500'));
const WARMUP = Number(arg('warmup', '4000'));
const W = Number(arg('width', '1368'));
const H = Number(arg('height', '912'));
const CPU = Number(arg('cpu', '4'));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), '.cache/ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort() : [];
  for (const d of dirs.reverse()) { const p = path.join(base, d, 'chrome-linux/chrome'); if (fs.existsSync(p)) return p; }
  console.error('no Chromium found (set CHROME)'); process.exit(2);
}

fs.mkdirSync(out, { recursive: true });
const port = 9600 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  '--no-first-run', '--hide-scrollbars', '--no-sandbox', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { try { chrome.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} process.exit(code); };
setTimeout(() => { console.error('film: timed out'); done(1); }, 10 * 60 * 1000).unref();

let ok = false;
for (let i = 0; i < 75 && !ok; i++) { try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ok = true; } catch { await sleep(200); } }
if (!ok) { console.error('Chromium did not start'); done(1); }
const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push(`pageerror\t${m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text}`);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(m.params.type))
    logs.push(`console.${m.params.type}\t${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
// A fallback frame counter, for pages without window.__wallPerf.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__filmRaf = { frames: 0, worstGapMs: 0 };
  (function tick(last) { requestAnimationFrame((t) => { const r = window.__filmRaf; r.frames++; if (last) r.worstGapMs = Math.max(r.worstGapMs, t - last); tick(t); }); })(0);
` });
await send('Emulation.setCPUThrottlingRate', { rate: CPU });
await send('Page.navigate', { url });
await sleep(WARMUP);

const read = () => evaluate(`JSON.stringify(window.__wallPerf ? { s: 'wall', ...window.__wallPerf } : { s: 'raf', ...window.__filmRaf })`).then((v) => JSON.parse(v ?? '{}'));
const p0 = await read(); const t0 = Date.now();
const times = [];
for (let i = 0; i < FRAMES; i++) {
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
  const name = `frame-${String(i + 1).padStart(2, '0')}.jpg`;
  fs.writeFileSync(path.join(out, name), Buffer.from(shot.data, 'base64'));
  times.push(((Date.now() - t0) / 1000).toFixed(1));
  if (i < FRAMES - 1) await sleep(EVERY);
}
const p1 = await read(); const secs = (Date.now() - t0) / 1000;
const perf = {
  fps: Number((((p1.frames ?? 0) - (p0.frames ?? 0)) / secs).toFixed(1)),
  worstGapMs: Math.round(p1.worstGapMs ?? 0),
  frames: FRAMES, seconds: Number(secs.toFixed(1)), cpuThrottle: CPU, source: p1.s ?? 'none',
};
fs.writeFileSync(path.join(out, 'perf.json'), JSON.stringify(perf, null, 2) + '\n');

// The contact sheet: a local page with the frames in a grid, screenshotted.
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
const cols = 4, rows = Math.ceil(FRAMES / cols), cw = 684, ch = 456;
const cells = times.map((t, i) => `<figure><img src="frame-${String(i + 1).padStart(2, '0')}.jpg"><figcaption>${t} s</figcaption></figure>`).join('');
fs.writeFileSync(path.join(out, 'sheet.html'), `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:4px}
  figure{margin:0;position:relative}img{width:${cw}px;height:${ch}px;display:block}
  figcaption{position:absolute;left:6px;top:4px;font:12px monospace;color:#fff;background:#000a;padding:1px 4px}
  .perf{grid-column:1/-1;font:14px monospace;color:#ccc;padding:6px}</style>
  <div class="perf">${url} · ${perf.fps} fps · worst gap ${perf.worstGapMs} ms · cpu x${CPU} (${perf.source})</div>${cells}`);
await send('Emulation.setDeviceMetricsOverride', { width: cols * (cw + 4), height: rows * (ch + 4) + 32, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `file://${path.resolve(out, 'sheet.html')}` });
await sleep(1200);
const sheet = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(out, 'sheet.png'), Buffer.from(sheet.data, 'base64'));
fs.writeFileSync(path.join(out, 'console.txt'), logs.join('\n') + (logs.length ? '\n' : ''));
console.log(`${path.join(out, 'sheet.png')} · ${perf.fps} fps · worst ${perf.worstGapMs} ms · ${logs.length} console/page errors`);
ws.close(); done(0);
