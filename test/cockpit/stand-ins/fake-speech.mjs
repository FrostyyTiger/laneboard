#!/usr/bin/env node
// The fake speech service (cockpit spec `stand-ins.md` §3): a WebSocket server
// that speaks WhisperLiveKit's protocol (`protocols.md` §12) and replays scripted
// partials and finals. It runs inside the test process:
//
//   const speech = await startFakeSpeech({ script: 'c2-tap', clock: testClock });
//   speech.url                 → 'ws://127.0.0.1:<port>/asr'
//   speech.use('c2-faults', 'busy');  await speech.stop();  await speech.start();
//   speech.log();              await speech.close();
//
//   node test/cockpit/stand-ins/fake-speech.mjs --port 7792 --script demo   (§3.5)
//
// One connection is one utterance. The audio is never looked at, only counted:
// any non-empty binary frame is speech, the empty one is the end of audio.
// `at` times run from the connection's first audio frame, on `clock` (an object
// with `now()`, `setTimeout(fn, ms)` and `clearTimeout(handle)`; real time
// without it).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const USAGE = `usage: node test/cockpit/stand-ins/fake-speech.mjs --port <port> --script <name>
A stand-in for the speech service in the cockpit's tests (docs/plans/cockpit/spec/stand-ins.md §3).
Serves ws://127.0.0.1:<port>/asr from test/cockpit/scripts/<name>.json; Ctrl-C stops it.
`;

export const SCRIPTS_DIR = path.resolve(import.meta.dirname, '..', 'scripts');
export const PATH = '/asr';
/** `finalAfterMs` when an utterance leaves it out (`stand-ins.md` §5: "150 unless said"). */
export const FINAL_AFTER_MS = 150;
/** The `no_audio_detected` cadence of a `noAudio` utterance (§3.2). */
export const NO_AUDIO_EVERY_MS = 1000;
export const FAULTS = ['no-config', '401', '403', 'pcm-off', 'withhold-final'];

/** The real clock: what the fake runs on when no test clock is given. */
export const realClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
});

/** A script by name (`test/cockpit/scripts/<name>.json`) or as an object already. */
export function loadScript(script, dir = SCRIPTS_DIR) {
  const s = typeof script === 'string'
    ? JSON.parse(fs.readFileSync(path.join(dir, `${script}.json`), 'utf8'))
    : script;
  const problem = scriptProblem(s);
  if (problem) throw new Error(`fake speech: script ${typeof script === 'string' ? script : s?.name}: ${problem}`);
  return s;
}

/** Why a script is not one §3.2 describes, or null. */
export function scriptProblem(s) {
  if (!s || typeof s !== 'object') return 'not an object';
  if (!Array.isArray(s.utterances) || s.utterances.length === 0) return 'no utterances';
  const ids = new Set();
  for (const u of s.utterances) {
    if (typeof u?.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(u.id)) return `utterance id ${JSON.stringify(u?.id)} is not kebab-case`;
    if (ids.has(u.id)) return `utterance id ${u.id} twice`;
    ids.add(u.id);
    if (u.fault != null && faultKind(u.fault) == null) return `utterance ${u.id}: unknown fault ${JSON.stringify(u.fault)}`;
    for (const up of u.updates ?? []) {
      if (!Number.isFinite(up?.at)) return `utterance ${u.id}: an update without a numeric at`;
    }
  }
  return null;
}

/** Which row of §3.3 a `fault` value is, or null. */
export function faultKind(f) {
  if (typeof f === 'string') return FAULTS.includes(f) ? f : null;
  if (f && typeof f === 'object') {
    if (Number.isFinite(f.errorAt)) return 'error';
    if (Number.isFinite(f.closeAt)) return 'close';
    if (typeof f.requireToken === 'string') return 'require-token';
  }
  return null;
}

/** An `active_transcription` message (`protocols.md` §12.2) from a script's `{lines, buffer}`. */
export function transcription({ lines = [], buffer = '' } = {}) {
  return {
    status: 'active_transcription',
    lines: lines.map((text) => ({ speaker: 0, text })),
    buffer_transcription: buffer,
  };
}

const STATUS_TEXT = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' };

export async function startFakeSpeech({ script, clock = realClock, port = 0, host = '127.0.0.1', scriptsDir = SCRIPTS_DIR } = {}) {
  let current = loadScript(script, scriptsDir);
  let next = 0; // index of the utterance the next connection gets
  let connCount = 0;
  const entries = [];
  const sockets = new Set(); // open WebSockets, closed by close()
  const log = (e) => entries.push({ atMs: clock.now(), ...e });

  const wss = new WebSocketServer({ noServer: true });
  let server = null;
  let boundPort = port;

  function refuse(socket, status) {
    socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function onUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://fake-speech.invalid');
    if (url.pathname !== PATH) { refuse(socket, 404); return; }
    const conn = ++connCount;
    const u = current.utterances[next];
    next = (next + 1) % current.utterances.length;
    const auth = req.headers.authorization;
    log({ kind: 'connect', conn, query: Object.fromEntries(url.searchParams), auth: auth != null, utterance: u.id });
    const kind = faultKind(u.fault);
    let status = 0;
    if (kind === '401' || kind === '403') status = Number(kind);
    else if (kind === 'require-token' && auth !== `Bearer ${u.fault.requireToken}`) status = 401;
    if (status) { log({ kind: 'refused', conn, status }); refuse(socket, status); return; }
    wss.handleUpgrade(req, socket, head, (ws) => utterance(ws, conn, u, kind));
  }

  /** One connection playing one utterance (§3.2, §3.3). */
  function utterance(ws, conn, u, kind) {
    sockets.add(ws);
    const timers = new Set();
    let t0 = null; // the first audio frame's clock time
    let ended = false; // the end frame came
    let closed = false;

    const later = (ms, fn) => {
      const h = clock.setTimeout(() => { timers.delete(h); if (!closed) fn(); }, Math.max(0, ms));
      timers.add(h);
    };
    const clearAll = () => { for (const h of timers) clock.clearTimeout(h); timers.clear(); };
    const send = (what, msg) => { if (closed) return; ws.send(JSON.stringify(msg)); log({ kind: 'sent', conn, what }); };
    const closeBy = (code) => {
      if (closed) return;
      closed = true;
      clearAll();
      log({ kind: 'close', conn, code, by: 'fake' });
      ws.close(code);
    };

    ws.on('close', (code) => {
      sockets.delete(ws);
      if (closed) return;
      closed = true;
      clearAll();
      log({ kind: 'close', conn, code, by: 'client' });
    });

    if (kind !== 'no-config') send('config', { type: 'config', useAudioWorklet: kind !== 'pcm-off', mode: 'full' });

    const firstFrame = () => {
      t0 = clock.now();
      for (const up of u.updates ?? []) later(up.at, () => send('update', transcription(up)));
      if (u.noAudio) {
        const tick = () => later(NO_AUDIO_EVERY_MS, () => {
          send('no-audio', { status: 'no_audio_detected', lines: [], buffer_transcription: '' });
          tick();
        });
        tick();
      }
      if (kind === 'error') later(u.fault.errorAt, () => send('error', { status: 'error', error: String(u.fault.error ?? 'error') }));
      if (kind === 'close') later(u.fault.closeAt, () => closeBy(u.fault.code ?? 1011));
    };

    const endFrame = () => {
      ended = true;
      // An update (or fault) whose `at` falls after the end frame is not sent (§3.2).
      clearAll();
      if (kind === 'withhold-final') return; // nothing more, the socket stays open (S-C2-17)
      later(u.finalAfterMs ?? FINAL_AFTER_MS, () => {
        send('final', transcription(u.noAudio ? {} : u.final));
        send('ready_to_stop', { type: 'ready_to_stop' });
        closeBy(1000);
      });
    };

    ws.on('message', (data, isBinary) => {
      if (!isBinary || closed || ended) return; // text from the room is not part of the protocol
      if (data.length === 0) { log({ kind: 'end-frame', conn }); endFrame(); return; }
      log({ kind: 'frame', conn, bytes: data.length });
      if (t0 == null) firstFrame();
    });
  }

  async function start() {
    if (server) return;
    server = http.createServer((req, res) => { res.writeHead(426, { 'content-type': 'text/plain' }); res.end('websocket only\n'); });
    server.on('upgrade', onUpgrade);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(boundPort, host, () => { server.off('error', reject); resolve(); });
    });
    boundPort = server.address().port;
  }

  /** Closes the listener: connects are refused. Open connections play on. */
  async function stop() {
    if (!server) return;
    const s = server;
    server = null;
    await new Promise((resolve) => s.close(() => resolve()));
  }

  await start();

  return {
    get url() { return `ws://${host}:${boundPort}${PATH}`; },
    get port() { return boundPort; },
    use(name, id) {
      const s = loadScript(name, scriptsDir);
      let i = 0;
      if (id != null) {
        i = s.utterances.findIndex((u) => u.id === id);
        if (i < 0) throw new Error(`fake speech: script ${s.name ?? name} has no utterance ${id}`);
      }
      current = s;
      next = i;
    },
    start,
    stop,
    log: () => entries.map((e) => ({ ...e })),
    async close() {
      const closing = [...sockets].map((ws) => new Promise((r) => { ws.once('close', r); ws.terminate(); }));
      const stopping = stop();
      // A server's close waits for its open sockets; the terminate above ends them.
      await Promise.all([...closing, stopping]);
      wss.close();
    },
  };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') o.port = Number(argv[++i]);
    else if (argv[i] === '--script') o.script = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return o;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help')) { process.stdout.write(USAGE); return; }
  let o;
  try { o = parseArgs(argv); } catch (e) { process.stderr.write(`${e.message}\n${USAGE}`); process.exit(2); }
  if (!o.script || !Number.isInteger(o.port)) { process.stderr.write(USAGE); process.exit(2); }
  let speech;
  try {
    speech = await startFakeSpeech({ script: o.script, port: o.port });
  } catch (e) {
    process.stderr.write(`fake speech: ${e.code === 'ENOENT' ? `no script ${path.join(SCRIPTS_DIR, `${o.script}.json`)}` : e.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`fake speech ${speech.url} (script ${o.script})\n`);
  const bye = () => { speech.close().then(() => process.exit(0)); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
