// The fake speech service (cockpit spec `stand-ins.md` §3, §7 step 2): §3.2's
// script format and one case per §3.3 fault row, against a plain `ws` client
// playing the room's side of `protocols.md` §12.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import WebSocket from 'ws';
import { startFakeSpeech, scriptProblem, faultKind, transcription } from './cockpit/stand-ins/fake-speech.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE = path.join(ROOT, 'test/cockpit/stand-ins/fake-speech.mjs');

/** A manual clock: time stands still until `advance(ms)`; due timers fire in time order. */
function manualClock(start = 1793080800000) {
  let t = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) { const h = ++seq; timers.set(h, { at: t + ms, seq: h, fn }); return h; },
    clearTimeout(h) { timers.delete(h); },
    advance(ms) {
      const until = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= until).sort(([, a], [, b]) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = until;
    },
  };
}

// §3.2's example, `c2-tap` `what-failed`.
const WHAT_FAILED = {
  id: 'what-failed',
  updates: [
    { at: 600, lines: [], buffer: 'what' },
    { at: 1100, lines: [], buffer: 'what failed' },
    { at: 1600, lines: ['what failed'], buffer: 'tonight' }],
  finalAfterMs: 150,
  final: { lines: ['What failed tonight?'], buffer: '' },
};
const PARTIAL = [{ at: 600, lines: [], buffer: 'stop the nightly' }];
// `c2-faults` as `stand-ins.md` §5 lists it, inline: T5 writes the C1 scripts only.
const FAULTS_SCRIPT = {
  name: 'c2-faults',
  utterances: [
    { id: 'no-config', fault: 'no-config', updates: [] },
    { id: 'token', fault: '401', updates: [] },
    { id: 'busy', fault: '403', updates: [] },
    { id: 'pcm-off', fault: 'pcm-off', updates: [] },
    { id: 'error-mid', updates: PARTIAL, fault: { errorAt: 1200, error: 'model crashed' } },
    { id: 'close-mid', updates: PARTIAL, fault: { closeAt: 1200, code: 1011 } },
    { id: 'error-early', updates: [], fault: { errorAt: 400, error: 'model crashed' } },
    { id: 'no-final', updates: [{ at: 600, lines: [], buffer: 'how is' }, { at: 1600, lines: [], buffer: 'how is the hub' }], fault: 'withhold-final' },
    { id: 'token-required', updates: WHAT_FAILED.updates, final: WHAT_FAILED.final, fault: { requireToken: 't0k' } }],
};
const TAP_SCRIPT = { name: 'c2-tap', utterances: [WHAT_FAILED, { id: 'only-failed', updates: [{ at: 600, lines: [], buffer: 'only' }], final: { lines: ['Only the failed one.'], buffer: '' } }] };

async function speechFor(t, script, opts = {}) {
  const speech = await startFakeSpeech({ script, ...opts });
  t.after(() => speech.close());
  return speech;
}

/**
 * Connects as the room does (§12.1). Resolves `{ws, msgs, next(), closed}` on open,
 * or `{status}` when the upgrade is answered with an HTTP status.
 */
function connect(url, { query = '?language=de&mode=full', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url + query, { headers });
    const msgs = [];
    const waiters = [];
    let closeInfo = null;
    const closeWaiters = [];
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      const w = waiters.shift();
      if (w) w(m); else msgs.push(m);
    });
    ws.on('close', (code) => { closeInfo = { code }; for (const w of closeWaiters.splice(0)) w(closeInfo); });
    ws.on('unexpected-response', (_req, res) => { resolve({ status: res.statusCode }); res.resume(); ws.terminate(); });
    ws.on('error', (e) => reject(e));
    ws.on('open', () => resolve({
      ws,
      msgs,
      next: () => (msgs.length ? Promise.resolve(msgs.shift()) : new Promise((r) => waiters.push(r))),
      closed: () => (closeInfo ? Promise.resolve(closeInfo) : new Promise((r) => closeWaiters.push(r))),
    }));
  });
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const frame = (n = 3200) => Buffer.alloc(n, 1);
const END = Buffer.alloc(0);
const kinds = (log) => log.map((e) => (e.kind === 'sent' ? `sent:${e.what}` : e.kind));

test('started with no arguments it prints its usage and exits 0 (slices §2)', () => {
  const r = spawnSync(process.execPath, [FAKE], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^usage: node test\/cockpit\/stand-ins\/fake-speech\.mjs/);
});

test('scripts: kebab-case unique ids, known faults, numeric at (§3.2, §3.3)', () => {
  assert.equal(scriptProblem(FAULTS_SCRIPT), null);
  assert.equal(scriptProblem(TAP_SCRIPT), null);
  assert.match(scriptProblem({ utterances: [] }), /no utterances/);
  assert.match(scriptProblem({ utterances: [{ id: 'What' }] }), /kebab-case/);
  assert.match(scriptProblem({ utterances: [{ id: 'a' }, { id: 'a' }] }), /twice/);
  assert.match(scriptProblem({ utterances: [{ id: 'a', fault: '500' }] }), /unknown fault/);
  assert.match(scriptProblem({ utterances: [{ id: 'a', updates: [{ lines: [] }] }] }), /numeric at/);
  assert.equal(faultKind({ errorAt: 1200, error: 'x' }), 'error');
  assert.equal(faultKind({ closeAt: 1200, code: 1011 }), 'close');
  assert.equal(faultKind({ requireToken: 't0k' }), 'require-token');
  assert.deepEqual(transcription({ lines: ['what failed'], buffer: 'tonight' }),
    { status: 'active_transcription', lines: [{ speaker: 0, text: 'what failed' }], buffer_transcription: 'tonight' });
});

test('an utterance: config, updates at their `at` from the first frame, the final 150 ms after the end frame, ready_to_stop, close 1000 (§3.1, §3.2, §3.4)', async (t) => {
  const clock = manualClock();
  const speech = await speechFor(t, TAP_SCRIPT, { clock });
  assert.match(speech.url, /^ws:\/\/127\.0\.0\.1:\d+\/asr$/);
  const c = await connect(speech.url);
  assert.deepEqual(await c.next(), { type: 'config', useAudioWorklet: true, mode: 'full' });

  clock.advance(5000); // nothing runs before the first audio frame
  c.ws.send(frame(3200));
  await tick();
  const f = clock.now();
  clock.advance(599);
  await tick();
  assert.equal(c.msgs.length, 0, 'nothing before 600 ms');
  clock.advance(1);
  assert.deepEqual(await c.next(), transcription({ lines: [], buffer: 'what' }));
  clock.advance(500);
  assert.deepEqual(await c.next(), transcription({ lines: [], buffer: 'what failed' }));
  clock.advance(500);
  assert.deepEqual(await c.next(), transcription({ lines: ['what failed'], buffer: 'tonight' }));

  c.ws.send(frame(1600));
  c.ws.send(END);
  await tick();
  clock.advance(149);
  await tick();
  assert.equal(c.msgs.length, 0, 'the final waits finalAfterMs');
  clock.advance(1);
  assert.deepEqual(await c.next(), transcription({ lines: ['What failed tonight?'], buffer: '' }));
  assert.deepEqual(await c.next(), { type: 'ready_to_stop' });
  assert.equal((await c.closed()).code, 1000);

  const log = speech.log();
  assert.deepEqual(kinds(log), ['connect', 'sent:config', 'frame', 'sent:update', 'sent:update', 'sent:update',
    'frame', 'end-frame', 'sent:final', 'sent:ready_to_stop', 'close']);
  assert.deepEqual(log[0].query, { language: 'de', mode: 'full' });
  assert.equal(log[0].auth, false);
  assert.equal(log[0].conn, 1);
  assert.equal(log[2].bytes, 3200);
  assert.equal(log[2].atMs, f);
  assert.equal(log[3].atMs, f + 600);
  assert.equal(log[5].atMs, f + 1600);
  assert.equal(log[8].atMs, log[7].atMs + 150);
  assert.deepEqual(log.at(-1), { atMs: log[8].atMs, kind: 'close', conn: 1, code: 1000, by: 'fake' });
});

test('runs on real time without a clock; an update after the end frame is not sent (§3.1, §3.2)', async (t) => {
  const speech = await speechFor(t, { name: 'x', utterances: [{ id: 'short', updates: [{ at: 40, lines: [], buffer: 'one' }, { at: 400, lines: [], buffer: 'two' }], finalAfterMs: 20, final: { lines: ['One.'], buffer: '' } }] });
  const c = await connect(speech.url);
  await c.next(); // config
  c.ws.send(frame());
  assert.deepEqual(await c.next(), transcription({ lines: [], buffer: 'one' }));
  c.ws.send(END);
  assert.deepEqual(await c.next(), transcription({ lines: ['One.'], buffer: '' }));
  assert.deepEqual(await c.next(), { type: 'ready_to_stop' });
  assert.equal((await c.closed()).code, 1000);
  await tick(450);
  assert.ok(!speech.log().some((e) => e.kind === 'sent' && e.what === 'update' && e.atMs > speech.log().find((x) => x.kind === 'end-frame').atMs));
  assert.equal(speech.log().filter((e) => e.what === 'update').length, 1);
});

test('noAudio: no_audio_detected every 1 s, then an empty final (§3.2, S-C2-05)', async (t) => {
  const clock = manualClock();
  const speech = await speechFor(t, { name: 'c2-limits', utterances: [{ id: 'nothing-heard', noAudio: true }] }, { clock });
  const c = await connect(speech.url);
  await c.next();
  c.ws.send(frame());
  await tick();
  clock.advance(3000);
  for (let i = 0; i < 3; i++) assert.deepEqual(await c.next(), { status: 'no_audio_detected', lines: [], buffer_transcription: '' });
  c.ws.send(END);
  await tick();
  clock.advance(150);
  assert.deepEqual(await c.next(), transcription({ lines: [], buffer: '' }));
  assert.deepEqual(await c.next(), { type: 'ready_to_stop' });
  assert.equal((await c.closed()).code, 1000);
});

test('use(name, id): scripts by name, the named utterance next, then on in order and round (§3.1, §3.2, D293)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-speech-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'c2-tap.json'), JSON.stringify(TAP_SCRIPT));
  fs.writeFileSync(path.join(dir, 'c2-faults.json'), JSON.stringify(FAULTS_SCRIPT));
  const speech = await speechFor(t, 'c2-tap', { scriptsDir: dir });
  const ids = async () => { const c = await connect(speech.url); if (c.ws) c.ws.close(1000); await tick(); return speech.log().filter((e) => e.kind === 'connect').at(-1).utterance; };
  assert.equal(await ids(), 'what-failed');
  assert.equal(await ids(), 'only-failed');
  assert.equal(await ids(), 'what-failed', 'after the last, the first again');
  speech.use('c2-faults', 'error-early');
  assert.equal(await ids(), 'error-early');
  assert.equal(await ids(), 'no-final');
  assert.equal(await ids(), 'token-required');
  assert.equal(await ids(), 'no-config');
  speech.use('c2-tap');
  assert.equal(await ids(), 'what-failed');
  assert.throws(() => speech.use('c2-tap', 'nope'), /no utterance nope/);
});

test('fault: stopped — the port refuses connections; start() listens again on the same port (§3.3, S-C2-15)', async (t) => {
  const speech = await speechFor(t, TAP_SCRIPT);
  const { url, port } = speech;
  await speech.stop();
  await assert.rejects(connect(url), /ECONNREFUSED/);
  await speech.start();
  assert.equal(speech.port, port);
  assert.equal(speech.url, url);
  const c = await connect(url);
  assert.deepEqual(await c.next(), { type: 'config', useAudioWorklet: true, mode: 'full' });
});

test('fault: no-config — the upgrade is accepted, config never comes (§3.3)', async (t) => {
  const speech = await speechFor(t, FAULTS_SCRIPT);
  speech.use(FAULTS_SCRIPT, 'no-config');
  const c = await connect(speech.url);
  c.ws.send(frame());
  await tick(300);
  assert.equal(c.msgs.length, 0);
  assert.equal(c.ws.readyState, WebSocket.OPEN);
  assert.ok(!speech.log().some((e) => e.kind === 'sent'));
});

test('fault: "401" and "403" — the upgrade is answered with that status (§3.3, S-C2-15)', async (t) => {
  const speech = await speechFor(t, FAULTS_SCRIPT);
  speech.use(FAULTS_SCRIPT, 'token');
  assert.deepEqual(await connect(speech.url), { status: 401 });
  assert.deepEqual(await connect(speech.url), { status: 403 }, '`busy` follows `token`');
  assert.deepEqual(speech.log().filter((e) => e.kind === 'refused').map((e) => [e.conn, e.status]), [[1, 401], [2, 403]]);
});

test('fault: pcm-off — config with useAudioWorklet:false (§3.3, protocols §12.1)', async (t) => {
  const speech = await speechFor(t, FAULTS_SCRIPT);
  speech.use(FAULTS_SCRIPT, 'pcm-off');
  const c = await connect(speech.url);
  assert.deepEqual(await c.next(), { type: 'config', useAudioWorklet: false, mode: 'full' });
});

test('fault: errorAt — {"status":"error"} at that `at` (§3.3, S-C2-16)', async (t) => {
  const clock = manualClock();
  const speech = await speechFor(t, FAULTS_SCRIPT, { clock });
  speech.use(FAULTS_SCRIPT, 'error-mid');
  const c = await connect(speech.url);
  await c.next();
  c.ws.send(frame());
  await tick();
  const f = clock.now();
  clock.advance(1199);
  assert.deepEqual(await c.next(), transcription({ lines: [], buffer: 'stop the nightly' }));
  await tick();
  assert.equal(c.msgs.length, 0);
  clock.advance(1);
  assert.deepEqual(await c.next(), { status: 'error', error: 'model crashed' });
  assert.equal(speech.log().find((e) => e.what === 'error').atMs, f + 1200);
});

test('fault: closeAt — closes with that code at that `at` (§3.3, S-C2-16)', async (t) => {
  const clock = manualClock();
  const speech = await speechFor(t, FAULTS_SCRIPT, { clock });
  speech.use(FAULTS_SCRIPT, 'close-mid');
  const c = await connect(speech.url);
  await c.next();
  c.ws.send(frame());
  await tick();
  const f = clock.now();
  clock.advance(1200);
  assert.deepEqual(await c.next(), transcription({ lines: [], buffer: 'stop the nightly' }));
  assert.equal((await c.closed()).code, 1011);
  assert.deepEqual(speech.log().at(-1), { atMs: f + 1200, kind: 'close', conn: 1, code: 1011, by: 'fake' });
});

test('fault: withhold-final — after the end frame nothing more, the socket stays open (§3.3, S-C2-17)', async (t) => {
  const clock = manualClock();
  const speech = await speechFor(t, FAULTS_SCRIPT, { clock });
  speech.use(FAULTS_SCRIPT, 'no-final');
  const c = await connect(speech.url);
  await c.next();
  c.ws.send(frame());
  await tick();
  clock.advance(1600);
  assert.equal((await c.next()).buffer_transcription, 'how is');
  assert.equal((await c.next()).buffer_transcription, 'how is the hub');
  c.ws.send(END);
  await tick();
  clock.advance(10_000);
  await tick(100);
  assert.equal(c.msgs.length, 0);
  assert.equal(c.ws.readyState, WebSocket.OPEN);
  c.ws.close(1000);
  await c.closed();
  await tick();
  assert.deepEqual(speech.log().at(-1).by, 'client');
});

test('fault: requireToken — 401 unless Authorization: Bearer <token> (§3.3, D49)', async (t) => {
  const speech = await speechFor(t, FAULTS_SCRIPT);
  speech.use(FAULTS_SCRIPT, 'token-required');
  assert.deepEqual(await connect(speech.url), { status: 401 });
  speech.use(FAULTS_SCRIPT, 'token-required');
  assert.deepEqual(await connect(speech.url, { headers: { authorization: 'Bearer wrong' } }), { status: 401 });
  speech.use(FAULTS_SCRIPT, 'token-required');
  const c = await connect(speech.url, { headers: { authorization: 'Bearer t0k' } });
  assert.deepEqual(await c.next(), { type: 'config', useAudioWorklet: true, mode: 'full' });
  assert.deepEqual(speech.log().filter((e) => e.kind === 'connect').map((e) => e.auth), [false, true, true]);
});

test('only /asr is answered', async (t) => {
  const speech = await speechFor(t, TAP_SCRIPT);
  assert.deepEqual(await connect(speech.url.replace('/asr', '/other')), { status: 404 });
});
