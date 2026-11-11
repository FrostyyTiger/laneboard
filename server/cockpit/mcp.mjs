// The room's MCP server: what the cockpit's agent may read (docs/cockpit-tools.md).
//
//   createMcp({boardUrl, focusOf, proposeTo, log, fetchImpl, now, token}) → {token, listen(port), stop(), call(name, args)}
//
// Streamable HTTP, JSON answers only, POST /mcp on 127.0.0.1 (spec c3-see.md §1).
// Every tool reads, and none can change anything. `propose` only puts a card
// in front of the owner (proposeTo, the room link's propose): on their yes
// their own page sends the decision, as them, through the board's dispatcher.
// Board text is untrusted: a tool copies named fields into fresh objects, cut
// to length, never a whole response.
import crypto from 'node:crypto';
import http from 'node:http';
import { isoAt } from './iso.mjs';

const MAX_BODY = 65536;
const READ_TIMEOUT_MS = 5000;
const CACHE_MS = 5000;
const MAX_CALLS_AT_ONCE = 4;
const MAX_CALLS_PER_MIN = 60;
const MAX_RESULT = 24000;
const MAX_ROWS = 50;
const MAX_TREE = 40;
const STALE_S = 600;
const PROTOCOL = '2025-06-18';
const RUN_ARG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$/;
const SCREEN_ARG = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
const WHENS = ['prompt', 'now'];
const ID_ARG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,127})?$/;
const ITEM_DECISIONS = ['approve', 'reject', 'pick', 'answer'];
const RUN_DECISIONS = ['pause', 'resume', 'stop'];

class BadArg extends Error {}
/** A failure the agent can act on: one sentence, `isError`. */
class Said extends Error {}

const cut = (v, n = 200) => {
  if (typeof v !== 'string') return null;
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
const iso = (ms) => (Number.isFinite(ms) ? isoAt(ms) : null);

const TOOLS = [
  {
    name: 'waiting',
    description: 'What waits for the owner across every run engine: approvals, picks, questions, gates, oldest first. Read only.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      product: { type: 'string', description: 'only this product' },
    } },
    check: { product: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/ },
  },
  {
    name: 'runs',
    description: 'Runs on the engines: product, goal, state, where they are, cost. Give run (an id, or engine/id) for one run with its tree and gates.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      run: { type: 'string', description: 'a run id, or engine/run id' },
      state: { type: 'string', description: 'only runs in this state' },
    } },
    check: { run: RUN_ARG, state: /^[a-z][a-z-]{0,31}$/ },
  },
  {
    name: 'focus',
    description: 'What the owner sees on a screen: view, the selected node, the open run. Call it when the owner says here, this or that.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      screen: { type: 'string', description: 'a screen name; default the one that asked' },
      when: { type: 'string', enum: WHENS, description: 'prompt: when the owner asked (default); now: as it is' },
    } },
    check: { screen: SCREEN_ARG, when: new RegExp(`^(${WHENS.join('|')})$`) },
  },
  {
    name: 'propose',
    description: 'Ask the owner to decide something. A card with your why shows on their screen; only their yes sends it, as them. '
      + 'For a waiting item (item: its id from waiting): approve, reject (text: the reason), pick (choice: an option id), answer (text: the answer). '
      + 'For a run (run: its id): pause, resume, stop. Waits up to 2 min for the answer.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['decision', 'why'], properties: {
      item: { type: 'string', description: 'a waiting item id, or engine/item id' },
      run: { type: 'string', description: 'a run id, or engine/run id' },
      decision: { type: 'string', enum: [...ITEM_DECISIONS, ...RUN_DECISIONS] },
      choice: { type: 'string', description: 'for pick: the option id' },
      text: { type: 'string', description: 'for reject: the reason; for answer: the answer. The owner sees and can change it.' },
      why: { type: 'string', description: 'one or two sentences: why you propose this' },
    } },
    check: {
      item: ID_ARG, run: RUN_ARG, decision: new RegExp(`^(${[...ITEM_DECISIONS, ...RUN_DECISIONS].join('|')})$`),
      choice: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, text: /^[\s\S]{1,4000}$/, why: /^[\s\S]{1,1000}$/,
    },
  },
];

/** Refuses anything but the tool's own string arguments. */
function checkArgs(tool, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new BadArg('arguments: must be an object');
  for (const [k, v] of Object.entries(args)) {
    const re = Object.hasOwn(tool.check, k) ? tool.check[k] : null;
    if (!re) throw new BadArg(`${k}: unknown argument`);
    if (typeof v !== 'string' || !re.test(v)) throw new BadArg(`${k}: must match ${re.source}`);
  }
}

function runRow(r) {
  return {
    run: cut(r.id, 128), engine: cut(r.engine, 64), product: cut(r.product, 64), goal: cut(r.goal, 64), goalTitle: cut(r.goalTitle),
    state: cut(r.state, 32), stop: cut(r.stop), node: cut(r.node, 128), costUsd: Number.isFinite(r.usage?.usd) ? r.usage.usd : null,
    pr: r.pr ? { state: cut(r.pr.state, 32), title: cut(r.pr.title) } : null,
    startedAt: iso(r.startedAt), updatedAt: iso(r.updatedAt), stale: r.stale === true,
  };
}

function waitRow(it, nowMs) {
  const c = it.content && typeof it.content === 'object' ? it.content : {};
  const options = Array.isArray(c.options) ? c.options.slice(0, 8).map((o) => ({ id: cut(o?.id, 64), title: cut(o?.title) })) : null;
  return {
    id: cut(it.id, 128), engine: cut(it.engine, 64), kind: cut(it.kind, 32), title: cut(it.title), product: cut(it.product, 64), run: cut(it.run, 128),
    question: cut(c.question), what: cut(c.what), ...(options ? { options } : {}),
    openedAt: iso(it.openedAt), waitMin: Number.isFinite(it.openedAt) ? Math.max(0, Math.floor((nowMs - it.openedAt) / 60000)) : null, stale: it.stale === true,
  };
}

const treeRow = (n) => ({ id: cut(n.id, 128), level: cut(n.level, 16), parent: cut(n.parent, 128), title: cut(n.title), state: cut(n.state, 32), reason: cut(n.reason) });

/** Moving and failing nodes first: the tree can be longer than an answer should be. */
function pickTree(tree) {
  const quiet = new Set(['done', 'passed', 'planned', 'open']);
  const rows = Array.isArray(tree) ? tree : [];
  const ordered = [...rows.filter((n) => !quiet.has(n?.state)), ...rows.filter((n) => quiet.has(n?.state))];
  return { nodes: ordered.slice(0, MAX_TREE).map(treeRow), left: Math.max(0, ordered.length - MAX_TREE) };
}

function engineTrouble(engines) {
  const bad = (engines ?? []).filter((e) => e?.state && e.state !== 'up' && e.state !== 'ok');
  return bad.length ? { missing: bad.slice(0, 10).map((e) => ({ source: cut(e.id, 64), why: cut(e.reason) ?? cut(e.state, 32) })) } : {};
}

export function createMcp({ boardUrl, focusOf = () => null, proposeTo = null, log = () => {}, fetchImpl = fetch, now = Date.now, token = crypto.randomBytes(32).toString('hex') }) {
  const cache = new Map();
  let running = 0;
  const queue = [];
  let window = [];
  let server = null;

  async function fetchBoard(p) {
    let r;
    try {
      r = await fetchImpl(`${boardUrl}${p}`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    } catch {
      throw new Said(`The board at ${boardUrl} did not answer in 5 s; nothing to read.`);
    }
    if (!r.ok) {
      if (r.status === 404) throw new Said('This board has no run data at that address; a hub does not carry engine data yet.');
      throw new Said(`The board answered ${r.status} for ${p}; try again in a minute.`);
    }
    try { return await r.json(); } catch { throw new Said(`The board sent something unreadable for ${p}; try again in a minute.`); }
  }

  /** One read through the 5 s cache; the promise is cached so a burst costs one request. */
  function board(p) {
    const at = now();
    const hit = cache.get(p);
    if (hit && at - hit.at < CACHE_MS) return hit.body;
    const body = fetchBoard(p);
    cache.set(p, { at, body });
    body.catch(() => cache.delete(p));
    return body;
  }

  const asOf = (source = 'board', at = now()) => {
    const ageS = Math.max(0, Math.round((now() - at) / 1000));
    return { source, at: isoAt(at), ageS, ...(ageS > STALE_S ? { stale: true } : {}) };
  };

  async function waiting({ product }) {
    const b = await board('/api/engines/waiting');
    const all = (b.items ?? []).filter((it) => !product || it.product === product);
    const items = all.slice(0, MAX_ROWS).map((it) => waitRow(it, now()));
    return { asOf: [asOf()], items, count: all.length, ...(all.length > MAX_ROWS ? { truncated: { items: all.length - MAX_ROWS } } : {}), ...engineTrouble(b.engines) };
  }

  async function findRun(rows, wanted) {
    const hits = rows.filter((r) => r.key === wanted || r.id === wanted);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Said(`Run "${cut(wanted, 64)}" is on more than one engine: ${hits.map((r) => r.key).slice(0, 10).join(', ')}.`);
    const names = rows.slice(0, 10).map((r) => r.id);
    const more = rows.length > 10 ? `, … (${rows.length - 10} more)` : '';
    throw new Said(`No run "${cut(wanted, 64)}". Known runs: ${names.join(', ') || 'none'}${more}.`);
  }

  async function oneRun(row) {
    const b = await board(`/api/engine/${encodeURIComponent(row.engine)}/run/${encodeURIComponent(row.id)}`);
    const full = b?.data?.run;
    if (!full) throw new Said(`Engine ${cut(row.engine, 64)} could not read run ${cut(row.id, 64)}.`);
    const { nodes, left } = pickTree(full.tree);
    return {
      ...runRow({ ...full, engine: row.engine, stale: b.stale }),
      tree: nodes,
      gates: (Array.isArray(full.gates) ? full.gates : []).slice(0, 20).map((g) => ({ id: cut(g?.id, 128), kind: cut(g?.kind, 32), state: cut(g?.state, 32) })),
      ...(left ? { truncated: { tree: left } } : {}),
    };
  }

  async function runs({ run, state }) {
    const b = await board('/api/engines/runs');
    const rows = b.runs ?? [];
    if (run) return { asOf: [asOf()], run: await oneRun(await findRun(rows, run)), ...engineTrouble(b.engines) };
    const all = rows.filter((r) => !state || r.state === state);
    return { asOf: [asOf()], runs: all.slice(0, MAX_ROWS).map(runRow), count: all.length, ...(all.length > MAX_ROWS ? { truncated: { runs: all.length - MAX_ROWS } } : {}), ...engineTrouble(b.engines) };
  }

  /** The Map node or run a route selects; what the board does not know is said, not guessed. */
  async function selected(sel) {
    if (!sel) return null;
    const id = sel.startsWith('node:') ? sel.slice(5) : sel;
    let map;
    try { map = await board('/api/map'); } catch { return { sel: cut(sel, 128), found: false }; }
    const n = (map?.nodes ?? []).find((x) => x?.id === id || x?.id === sel);
    if (!n) return { sel: cut(sel, 128), found: false };
    return { id: cut(n.id, 128), kind: cut(n.kind, 32), label: cut(n.label, 64), parent: cut(n.parent, 128), status: cut(n.status, 32), why: cut(n.why) };
  }

  async function openRun(route) {
    const wanted = route.run ?? (route.sel?.startsWith('run:') ? route.sel.slice(4) : null);
    if (!wanted) return null;
    let b;
    try { b = await board('/api/engines/runs'); } catch { return { run: cut(wanted, 128), found: false }; }
    const r = (b.runs ?? []).find((x) => x.key === wanted || x.id === wanted);
    return r ? runRow(r) : { run: cut(wanted, 128), found: false };
  }

  async function focus({ screen, when = 'prompt' }) {
    const state = focusOf();
    if (!state || state.size === 0) throw new Said('No screen has said what it shows yet.');
    const name = screen ?? [...state.keys()].at(-1);
    const seen = state.get(name);
    if (!seen) throw new Said(`No screen "${cut(name, 64)}". Screens: ${[...state.keys()].slice(0, 8).join(', ')}.`);
    const used = when === 'now' ? seen.live : (seen.atPrompt ?? seen.live);
    const route = used.focus.route ?? {};
    return {
      asOf: [asOf(`screen:${cut(name, 64)}`, used.at)], screen: cut(name, 64), when: when !== 'now' && used === seen.atPrompt ? 'prompt' : 'now',
      changedSincePrompt: Boolean(seen.atPrompt) && JSON.stringify(seen.atPrompt.focus.route) !== JSON.stringify(seen.live.focus.route),
      page: used.focus.page, view: route.view ?? null, route,
      selected: await selected(route.sel), run: await openRun(route),
    };
  }

  /** One item of the waiting list by id or engine/id, read fresh (a decision needs its newest revision). */
  async function findItem(wanted) {
    cache.delete('/api/engines/waiting');
    const b = await board('/api/engines/waiting');
    const items = b.items ?? [];
    const hits = items.filter((it) => it.id === wanted || `${it.engine}/${it.id}` === wanted);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Said(`Item "${cut(wanted, 64)}" waits on more than one engine; give engine/id.`);
    throw new Said(`Nothing waits as "${cut(wanted, 64)}" now; call waiting for what does.`);
  }

  async function propose({ item, run, decision, choice, text, why }, signal = null) {
    if (!proposeTo) throw new Said('No screen can show the proposal now.');
    if (Boolean(item) === Boolean(run)) throw new Said('Give item or run, one of them.');
    let p;
    if (item) {
      if (!ITEM_DECISIONS.includes(decision)) throw new Said(`For an item the decision is ${ITEM_DECISIONS.join(', ')}.`);
      const it = await findItem(item);
      const kind = it.kind;
      if (kind === 'question' && decision !== 'answer') throw new Said('A question takes answer, with text.');
      if (kind !== 'question' && decision === 'answer') throw new Said(`This is a ${cut(kind, 32)}, not a question: approve, reject or pick.`);
      if (decision === 'pick') {
        const ids = (Array.isArray(it.content?.options) ? it.content.options : []).map((o) => o?.id).filter((x) => typeof x === 'string');
        if (kind !== 'variant' || !ids.length) throw new Said('Only a variant item takes pick.');
        if (!ids.includes(choice)) throw new Said(`choice must be one of: ${ids.slice(0, 8).join(', ')}.`);
      } else if (choice) throw new Said('choice goes with pick only.');
      if (kind === 'variant' && decision === 'approve') throw new Said('A variant takes pick, with a choice.');
      if ((decision === 'reject' || decision === 'answer') && !text) throw new Said(`${decision} needs text: ${decision === 'reject' ? 'the reason' : 'the answer'}.`);
      if (decision === 'approve' && text) throw new Said('approve takes no text.');
      p = { engine: it.engine, item: it.id, decision, choice: choice ?? null, text: text ?? null, why, title: it.title };
    } else {
      if (!RUN_DECISIONS.includes(decision)) throw new Said(`For a run the decision is ${RUN_DECISIONS.join(', ')}.`);
      if (choice || text) throw new Said('A run decision takes no choice or text.');
      cache.delete('/api/engines/runs');
      const b = await board('/api/engines/runs');
      const r = await findRun(b.runs ?? [], run);
      const ok = decision === 'pause' ? ['running', 'at-gate', 'queued'].includes(r.state)
        : decision === 'resume' ? r.state === 'paused' : !['done', 'stopped'].includes(r.state);
      if (!ok) throw new Said(`Run ${cut(r.id, 64)} is ${cut(r.state, 32)}; it cannot ${decision} now.`);
      p = { engine: r.engine, run: r.id, decision, choice: null, text: null, why, title: r.goalTitle ?? r.id };
    }
    const { title, ...card } = p;
    const out = await proposeTo(card, signal);
    const what = `${decision} ${cut(title ?? card.item ?? card.run, 120)}`;
    switch (out?.end) {
      case 'sent':
        if (out.ok) return { done: true, said: `The owner said yes; ${what} went through.` };
        throw new Said(`The owner said yes, but it did not go through: ${cut(out.text, 300) ?? out.code ?? 'no reason given'}.`);
      case 'no': throw new Said('The owner said no.');
      case 'timeout': throw new Said('The owner did not answer within 2 min.');
      case 'gone': throw new Said('The screen went away before the owner answered.');
      case 'failed': throw new Said(`The screen could not show it: ${cut(out.text, 300) ?? 'no reason given'}.`);
      default: throw new Said(cut(out?.text, 300) ?? 'No screen can show the proposal now.');
    }
  }

  const handlers = { waiting, runs, focus, propose };

  function take() {
    return new Promise((ok) => { if (running < MAX_CALLS_AT_ONCE) { running += 1; ok(); } else queue.push(ok); });
  }
  function give() {
    const next = queue.shift();
    if (next) next(); else running -= 1;
  }

  const said = (text) => ({ content: [{ type: 'text', text }], isError: true });

  async function call(name, args = {}, signal = null) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new BadArg(`name: no tool ${cut(String(name), 64)}`);
    checkArgs(tool, args);
    const at = now();
    window = window.filter((t) => at - t < 60000);
    if (window.length >= MAX_CALLS_PER_MIN) return said('Too many board reads this minute; wait and ask again.');
    window.push(at);
    if (name === 'propose') {
      try {
        const result = await propose(args, signal);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (err) {
        if (err instanceof Said) return said(err.message);
        log(`cockpit mcp: propose failed: ${err?.message ?? err}`);
        return said('The proposal failed inside the room; nothing was decided.');
      }
    }
    await take();
    try {
      const result = await handlers[name](args);
      const text = JSON.stringify(result);
      if (text.length > MAX_RESULT) {
        const small = { asOf: result.asOf, cut: true, note: 'Too long for one answer; ask for one run or product.' };
        return { content: [{ type: 'text', text: JSON.stringify(small) }], structuredContent: small };
      }
      return { content: [{ type: 'text', text }], structuredContent: result };
    } catch (err) {
      if (err instanceof Said) return said(err.message);
      log(`cockpit mcp: ${name} failed: ${err?.message ?? err}`);
      return said('The read failed inside the room; try again in a minute.');
    } finally {
      give();
    }
  }

  async function rpc(msg, signal = null) {
    const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
    if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'not a JSON-RPC 2.0 request');
    if (msg.id === undefined) return null; // a notification
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL,
          capabilities: { tools: {} }, serverInfo: { name: 'laneboard', version: '1' },
        });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call':
        try { return reply(await call(msg.params?.name, msg.params?.arguments ?? {}, signal)); } catch (err) {
          if (err instanceof BadArg) return fail(-32602, err.message);
          throw err;
        }
      default: return fail(-32601, `no method ${cut(msg.method, 64)}`);
    }
  }

  const tokenBuf = Buffer.from(token);
  function authorized(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) return false;
    const given = Buffer.from(m[1]);
    return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
  }

  function send(res, status, body) {
    const text = body === null ? '' : JSON.stringify(body);
    res.writeHead(status, body === null ? {} : { 'content-type': 'application/json' });
    res.end(text);
  }

  async function onRequest(req, res) {
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
    if (req.headers.origin !== undefined) return send(res, 403, { error: 'no browsers' });
    if (req.url !== '/mcp') return send(res, 404, { error: 'not-found' });
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(res, 405, { error: 'POST only' }); }
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return send(res, 413, { error: 'too large' });
      parts.push(chunk);
    }
    let msg;
    try { msg = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }); }
    if (Array.isArray(msg) || msg === null || typeof msg !== 'object') return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'one request at a time' } });
    const gaveUp = new AbortController();
    res.on('close', () => { if (!res.writableFinished) gaveUp.abort(); });
    const out = await rpc(msg, gaveUp.signal);
    return out === null ? send(res, 202, null) : send(res, 200, out);
  }

  function listen(port) {
    return new Promise((ok, no) => {
      server = http.createServer((req, res) => {
        onRequest(req, res).catch((err) => { log(`cockpit mcp: ${err?.message ?? err}`); if (!res.headersSent) send(res, 500, { error: 'failed' }); else res.end(); });
      });
      server.once('error', no);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', no); ok(server.address()); });
    });
  }

  const stop = () => new Promise((ok) => { if (!server) ok(); else { server.closeAllConnections?.(); server.close(() => ok()); } });

  return { token, listen, stop, call };
}
