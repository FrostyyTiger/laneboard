// The demo engine. Loaded before app.js by the demo build (bin/demo.mjs), it
// replaces the two things that connect the page to a server, the WebSocket
// and fetch('/api/...'), with a simulation of the lab in world.js. The page
// itself is untouched: what you see is exactly the real frontend.
//
// Every write is refused with a short note. The demo never pretends that
// something ran.
(() => {
  const W = window.LANEBOARD_DEMO;
  if (!W) return;
  const H = 3600e3, MIN = 60e3;
  const t0 = Date.now();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const MODEL = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-4-5': 'Haiku 4.5' };
  const PRICE = { 'claude-opus-5-5': 0.9, 'claude-sonnet-5-5': 0.35, 'claude-haiku-4-5': 0.08 }; // $ per busy minute, roughly
  const root = (id) => `/home/user/code/${W.repo}-${id}`;

  // ------------------------------------------------------------ sessions

  let markerSeq = 40;
  const sessions = new Map();
  const log = new Map(); // name -> terminal lines (ANSI)
  const listeners = new Set(); // terminal sockets

  function addMarker(s, kind, text, ts = Date.now()) {
    s.lastMarker = { id: ++markerSeq, ts, lane: s.lane, session_name: s.name, kind, text, source: 'pane', dismissed_at: null };
  }

  function openingLines(l) {
    return [
      '\x1b[38;5;208m✻\x1b[0m \x1b[1mClaude Code\x1b[0m',
      `\x1b[2m  ${root(l.id)} · ${l.branch} · ${MODEL[l.model]}\x1b[0m`,
      '',
      `\x1b[2m>\x1b[0m Read docs/plans/${l.id}.md and continue with stage ${l.stage + 1}: ${l.stageTitle}.`,
      '',
      `\x1b[37m⏺\x1b[0m I'll pick up at stage ${l.stage + 1} (${l.stageTitle}). Reading the plan and the status doc first.`,
      '',
    ];
  }

  const TOOL_RESULT = {
    Edit: () => `Updated with ${Math.floor(rnd(2, 40))} additions and ${Math.floor(rnd(0, 18))} removals`,
    Write: () => `Wrote ${Math.floor(rnd(30, 180))} lines`,
    Read: () => `Read ${Math.floor(rnd(40, 400))} lines`,
    Grep: () => `Found ${Math.floor(rnd(2, 30))} matches in ${Math.floor(rnd(1, 9))} files`,
    Bash: (arg) => /test|pytest|typecheck/.test(arg)
      ? (Math.random() < 0.8 ? `\x1b[32m✓\x1b[0m ${Math.floor(rnd(12, 240))} passed \x1b[2m(${rnd(1.2, 19).toFixed(1)}s)\x1b[0m`
        : `\x1b[31m✗\x1b[0m 1 failed, ${Math.floor(rnd(20, 200))} passed`)
      : 'done',
  };

  function applyStep(s, now, quiet = false) {
    const l = s._lane;
    const [state, tool, arg] = l.script[s._step % l.script.length];
    const prev = s.state;
    s.state = state;
    if (prev !== state) s.stateSince = now;
    s.activity.tool = state === 'working' ? tool : null;
    // The server hands the frontend the tool input already flattened to a line.
    s.activity.toolInput = (state === 'working' || state === 'waiting_permission') && arg ? arg : null;
    s.activityAt = now;
    s.attentionScore = state === 'waiting_permission' ? 100 : state === 'waiting_question' ? 90 : state === 'done' ? 50 : 0;
    const lines = log.get(s.name);
    const push = (line) => { lines.push(line); for (const t of listeners) if (t.session === s.name) t.write(`${line}\r\n`); };
    if (state === 'working' && tool) {
      push(`\x1b[32m⏺\x1b[0m \x1b[1m${tool}\x1b[0m(${arg})`);
      push(`  \x1b[2m⎿\x1b[0m  ${TOOL_RESULT[tool](arg)}`);
      push('');
    } else if (state === 'waiting_permission') {
      push(`\x1b[32m⏺\x1b[0m \x1b[1m${tool}\x1b[0m(${arg})`);
      push('');
      push('\x1b[33m╭─ Bash command ─────────────────────────────────────────╮\x1b[0m');
      push(`\x1b[33m│\x1b[0m  ${arg}`);
      push('\x1b[33m│\x1b[0m  Do you want to proceed?');
      push('\x1b[33m│\x1b[0m  \x1b[1m❯ 1. Yes\x1b[0m   2. Yes, and don\'t ask again   3. No');
      push('\x1b[33m╰────────────────────────────────────────────────────────╯\x1b[0m');
      if (!quiet) addMarker(s, 'need', `NEED-HUMAN approve: ${arg}`);
    } else if (state === 'waiting_question') {
      push(`\x1b[37m⏺\x1b[0m ${l.question}`);
      push('');
      push('\x1b[2m> \x1b[0m\x1b[7m \x1b[0m');
    } else if (state === 'done') {
      push(`\x1b[37m⏺\x1b[0m Stage ${l.stages} is done and pushed. ${l.pr ? `PR #${l.pr.number} is up to date.` : ''}`);
      push('');
    }
    s.activity.lastAssistant = lines.filter((x) => x.startsWith('\x1b[37m⏺')).pop()?.replace(/\x1b\[[0-9;]*m/g, '').slice(2) ?? '';
    while (lines.length > 400) lines.shift();
    s.preview = lines.slice(-40);
    s.previewHtml = lines.filter((x) => x.trim()).slice(-8).map(ansiToHtml);
  }

  /** The same conversion the server does (server/ansi.mjs), for the few codes used here. */
  function ansiToHtml(line) {
    let out = '', style = {};
    for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
      const m = /^\x1b\[([0-9;]*)m$/.exec(part);
      if (m) {
        const codes = m[1].split(';').map(Number);
        for (let i = 0; i < codes.length; i++) {
          const c = codes[i];
          if (c === 0) style = {};
          else if (c === 1) style.bold = true;
          else if (c === 2) style.dim = true;
          else if (c === 7) style.inv = true;
          else if (c >= 30 && c <= 37) style.color = ['#000', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4'][c - 30];
          else if (c === 38 && codes[i + 1] === 5) { style.color = '#ff8700'; i += 2; }
        }
        continue;
      }
      if (!part) continue;
      const css = [style.color && `color:${style.color}`, style.bold && 'font-weight:600', style.dim && 'opacity:.65', style.inv && 'background:#dcdfe4;color:#1b1f27'].filter(Boolean).join(';');
      out += css ? `<span style="${css}">${esc(part)}</span>` : esc(part);
    }
    return out;
  }

  // The sessions start here, once everything they use is defined.
  for (const [i, l] of W.lanes.entries()) {
    if (l.idle) continue;
    const startedAt = t0 - rnd(1.5, 8) * H;
    const s = {
      name: l.id, lane: l.id, kind: 'claude', dir: root(l.id), branch: l.branch,
      tmuxTarget: `%${i + 3}`, paneId: `%${i + 3}`, paneCmd: 'claude', paneSize: { cols: 120, rows: 40 },
      attached: false, createdAt: startedAt, activityAt: t0,
      dirty: Math.floor(rnd(0, 6)), ahead: Math.floor(rnd(1, 9)), behind: 0,
      claude: { model: MODEL[l.model], modelId: l.model, startedAt, rssMb: Math.round(rnd(280, 620)), swapMb: 0, title: l.stageTitle },
      state: 'working', stateSource: 'hook', stateSince: t0 - rnd(1, 20) * MIN,
      activity: { tool: null, toolInput: null, lastUserPrompt: `Stage ${l.stage + 1}: ${l.stageTitle}`, lastAssistant: '', lastAssistantAt: t0 - MIN },
      context: { usedPct: Math.round(rnd(18, 70)), size: 200000 },
      cost: { usd: +(rnd(3, 30)).toFixed(2), usdToday: +(rnd(1, 9)).toFixed(2) },
      statuslineCostUsd: null, linesAdded: Math.floor(rnd(40, 900)), linesRemoved: Math.floor(rnd(10, 300)),
      rateLimits: null, preview: [], previewHtml: [], pinned: false, danger: null, attentionScore: 0,
      lastMarker: null,
      _lane: l, _step: l.startAt ?? Math.floor(rnd(0, l.script.length)), _next: t0 + (l.startAt != null ? rnd(25, 40) : rnd(1, 6)) * 1000,
    };
    if (l.marker) addMarker(s, l.marker[0], l.marker[1], t0 - rnd(4, 40) * MIN);
    sessions.set(s.name, s);
    log.set(s.name, openingLines(l));
    applyStep(s, t0, true);
  }

  // ------------------------------------------------------------ the clock

  let busyMin = 0;
  function advance(now) {
    const events = [];
    for (const s of sessions.values()) {
      if (s.state === 'working') {
        const dt = (now - (s._last ?? now)) / MIN;
        const usd = dt * PRICE[s._lane.model] * rnd(0.6, 1.4);
        s.cost.usd = +(s.cost.usd + usd).toFixed(3);
        s.cost.usdToday = +(s.cost.usdToday + usd).toFixed(3);
        s.context.usedPct = Math.min(96, s.context.usedPct + dt * rnd(0.5, 2));
        if (s.context.usedPct > 92) s.context.usedPct = 14; // it compacted
        s.context.usedPct = Math.round(s.context.usedPct);
        busyMin += dt;
      }
      s._last = now;
      if (now < s._next) continue;
      const l = s._lane;
      const [st] = l.script[s._step % l.script.length];
      if (st === 'done' && l.script.length === 1) { s._next = now + 60e3; continue; }
      s._step++;
      const before = s.state;
      applyStep(s, now);
      const waiting = s.state.startsWith('waiting');
      // A human answers a prompt in 20-50 s here; in real life, whenever.
      s._next = now + (waiting ? rnd(20, 50) : rnd(3, 9)) * 1000;
      if (s.state === 'working') {
        events.push({ ts: now, session_name: s.name, session_id: s.name, type: 'PreToolUse', subtype: s.activity.tool });
        if (before.startsWith('waiting') && s.lastMarker?.kind === 'need') s.lastMarker = null;
      } else if (waiting) {
        events.push({ ts: now, session_name: s.name, session_id: s.name, type: 'Notification', subtype: 'permission_prompt' });
      }
    }
    return events;
  }

  function sessionList() { return [...sessions.values()].map(({ _lane, _step, _next, _last, ...s }) => s); }

  function lanes() {
    return W.lanes.map((l) => ({
      id: l.id, root: root(l.id), branch: l.branch, hue: l.hue,
      sessions: sessions.has(l.id) ? [l.id] : [], merged: false, isMain: false,
      lastCommitAt: t0 - rnd(5, 90) * MIN, idle: !sessions.has(l.id),
      progress: { n: l.stage || null, m: l.stages, source: 'commit', at: t0 - 20 * MIN,
        current: l.stage >= l.stages ? { n: null, title: 'all stages done' } : { n: l.stage + 1, title: l.stageTitle } },
    }));
  }

  function attention() {
    return sessionList().filter((s) => s.attentionScore > 0)
      .sort((a, b) => b.attentionScore - a.attentionScore || a.stateSince - b.stateSince)
      .map((s) => ({ name: s.name, state: s.state, score: s.attentionScore, since: s.stateSince, danger: null }));
  }

  // ------------------------------------------------------------ box: PRs, CI, slots

  const runs = [];
  function pushRun(name, branch, status, conclusion, at) { runs.unshift({ name, branch, status, conclusion, createdAt: at }); runs.length = Math.min(runs.length, 14); }
  for (let i = 0; i < 9; i++) {
    const l = pick(W.lanes);
    pushRun(pick(['CI', 'CI', 'e2e', 'Preview deploy']), l.branch, 'completed', Math.random() < 0.85 ? 'success' : 'failure', t0 - (i + 1) * rnd(8, 25) * MIN);
  }
  function prs() {
    const out = {};
    for (const l of W.lanes) {
      if (!l.pr) { out[l.id] = { none: true }; continue; }
      const c = l.pr.checks;
      out[l.id] = {
        number: l.pr.number, url: `https://github.com/example/${W.repo}/pull/${l.pr.number}`, title: l.pr.title,
        state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', headSha: 'a1b2c3d',
        verdict: c === 'success' ? 'green' : c === 'failure' ? 'red' : 'pending',
        checks: c === 'success' ? { passed: 9, failed: 0, pending: 0, total: 9, failedNames: [] }
          : c === 'failure' ? { passed: 7, failed: 1, pending: 1, total: 9, failedNames: ['ios-build'] }
            : { passed: 5, failed: 0, pending: 4, total: 9, failedNames: [] },
      };
    }
    return out;
  }
  const slotLanes = ['checkout-v2', 'billing-webhooks', 'search-reindex'];
  function box(now) {
    const burn = {};
    for (const s of sessions.values()) burn[s.name] = +(s.cost.usdToday * 0.6).toFixed(2);
    return {
      launched: W.lanes.map((l, i) => ({ id: l.id, repo: W.repo, root: root(l.id), branch: l.branch, plan: `docs/plans/${l.id}.md`,
        slot: slotLanes.includes(l.id) ? slotLanes.indexOf(l.id) + 2 : null, model: l.model.split('-')[1], session: l.id,
        createdAt: t0 - (i + 2) * H, retiredAt: null })),
      readiness: { 'flaky-e2e': { ready: true, reasons: ['working tree clean', 'PR #409 green'], blockers: [], dirtyFiles: [], at: now } },
      jobs: [],
      prs: prs(),
      ci: { provider: 'gh', auth: { ok: true, checkedAt: now }, queue: { runs, queued: runs.filter((r) => r.status === 'queued').length, running: runs.filter((r) => r.status === 'in_progress').length, repo: `example/${W.repo}`, at: now } },
      burn5h: burn,
      guard: { provider: 'ports', ok: true, health: [{ name: 'staging api', ok: true, status: 200 }], containers: [{ name: 'staging-pg-1', state: 'running', status: 'Up 2 days' }], preventive: [], detective: [], ssOk: true, ports: [5432] },
      slots: [1, 2, 3, 4].map((n) => {
        const lane = n === 1 ? null : slotLanes[n - 2] ?? null;
        return { slot: n, exists: true, up: Boolean(lane), lane, lastLane: lane, owner: n === 1 ? 'reserved (manual work)' : lane ? `lane ${lane}` : null,
          orphan: false, laneSlot: n !== 1, ports: { pg: 15332 + n * 100, redis: 16279 + n * 100, s3: 18900 + n * 100 }, containers: [] };
      }),
    };
  }
  function tickCi(now) {
    const live = runs.find((r) => r.status !== 'completed');
    if (live && now - live.createdAt > rnd(40, 80) * 1000) { live.status = 'completed'; live.conclusion = Math.random() < 0.85 ? 'success' : 'failure'; return live; }
    if (!live && Math.random() < 0.08) {
      const s = pick([...sessions.values()].filter((x) => x.state === 'working'));
      if (s) pushRun('CI', s.branch, 'in_progress', null, now);
    }
    return null;
  }

  function vitals(now) {
    const working = [...sessions.values()].filter((s) => s.state === 'working').length;
    return {
      at: now, host: W.host, cpuPct: +(8 + working * rnd(4, 9)).toFixed(1),
      mem: { totalMb: 32000, availableMb: 18000 - working * 900, usedMb: 14000 + working * 900, swapTotalMb: 8192, swapUsedMb: 220 },
      load: [+(working * 0.5).toFixed(2), +(working * 0.45).toFixed(2), 1.9],
      disk: { sizeMb: 240000, usedMb: 131000, availMb: 109000, usedPct: 55 }, gpu: null,
      claudeRssMb: [...sessions.values()].reduce((a, s) => a + s.claude.rssMb, 0), sessionCount: sessions.size, laneboardRssMb: 118,
    };
  }

  // Rate limits climb with work and reset on their windows.
  const five = { usedPct: 31, resetsAt: t0 + 2.2 * H };
  const seven = { usedPct: 48, resetsAt: t0 + 3.4 * 24 * H };
  function limits(now) {
    const working = [...sessions.values()].filter((s) => s.state === 'working').length;
    five.usedPct = Math.min(99, five.usedPct + working * 0.004);
    seven.usedPct = Math.min(99, seven.usedPct + working * 0.0006);
    if (now > five.resetsAt) { five.usedPct = 2; five.resetsAt = now + 5 * H; }
    const rl = { fiveHour: { usedPct: Math.round(five.usedPct), resetsAt: five.resetsAt }, sevenDay: { usedPct: Math.round(seven.usedPct), resetsAt: seven.resetsAt } };
    for (const s of sessions.values()) s.rateLimits = rl;
    return rl;
  }

  // ------------------------------------------------------------ the Map

  const mapEvents = [];
  const probe = { web: 84, api: 112 };
  let incident = null; // { node, until }
  const LANE_WHY = { waiting_permission: 'waiting on a permission prompt', waiting_question: 'asked a question' };
  const LANE_STATUS = { working: 'working', waiting_permission: 'attention', waiting_question: 'attention', done: 'idle', idle: 'idle' };
  let prevStatus = new Map();

  function mapModel(now) {
    const nodes = W.nodes.map((n) => {
      const out = { id: n.id, parent: n.parent ?? null, kind: n.kind, label: n.label, order: n.order, sub: n.sub, detail: n.detail };
      if (n.kind === 'room') {
        if (n.expectStopped) { out.status = 'idle'; out.sub = n.sub; return out; }
        out.status = 'ok';
        const busy = n.id === 'agents' ? 0.25 + 0.08 * [...sessions.values()].filter((s) => s.state === 'working').length : rnd(0.03, 0.3);
        out.metrics = { cpu: +Math.min(0.95, busy).toFixed(2), mem: +rnd(0.35, 0.7).toFixed(2) };
        if (n.id === 'agents') out.metrics.disk = 0.55;
        if (n.probe) { probe[n.id] = Math.round(probe[n.id] * 0.8 + rnd(60, 140) * 0.2); out.sub = `200 · ${probe[n.id]} ms`; out.detail = { Check: `200 in ${probe[n.id]} ms` }; }
      } else if (n.kind === 'service') {
        out.status = 'ok';
        out.derived = true;
      } else if (n.kind === 'site') {
        out.status = 'ok';
        if (n.id === 'office') out.metrics = { cpu: +rnd(0.2, 0.45).toFixed(2), mem: 0.62 };
      } else out.status = 'ok';
      return out;
    });
    if (incident && now < incident.until) {
      const n = nodes.find((x) => x.id === incident.node);
      Object.assign(n, { status: 'warn', why: incident.why, sub: incident.sub });
    } else if (incident) {
      mapEvents.push({ at: now, node: incident.node, kind: 'ok', text: `${incident.node} recovered · ${probe[incident.node] ?? 90} ms` });
      incident = null;
    }
    for (const s of sessions.values()) {
      const st = LANE_STATUS[s.state] ?? 'idle';
      nodes.push({
        id: `lane:${s.name}`, parent: 'agents', kind: 'lane', label: s.name, status: st,
        why: st === 'attention' ? `${LANE_WHY[s.state]} · ${Math.max(1, Math.round((now - s.stateSince) / MIN))}m` : undefined,
        sub: s.state === 'working' && s.activity.tool ? `${s.activity.tool} ${String(s.activity.toolInput ?? '').split('/').slice(-2).join('/')}` : s.state === 'done' ? 'done' : s.branch,
        detail: { Branch: s.branch, Sessions: `${s.name} (${s.state})`, Plan: `stage ${s._lane.stage + 1} of ${s._lane.stages}` },
        session: s.name,
      });
    }
    const links = W.links.map((l) => ({ id: `${l.from}>${l.to}`, ...l, kind: l.kind ?? 'dep', live: Boolean(l.live) }));
    for (const s of sessions.values()) {
      const to = W.laneLinks[s.name];
      if (to) links.push({ id: `lane:${s.name}>${to}`, from: `lane:${s.name}`, to, kind: 'dep', label: 'changes', live: s.state === 'working' });
    }
    // Status changes become ticker lines, as on a real board.
    for (const n of nodes) {
      const was = prevStatus.get(n.id);
      if (was && was !== n.status && !n.derived && n.kind === 'lane') {
        const word = { working: 'is working', attention: 'needs you', idle: 'is idle' }[n.status] ?? n.status;
        mapEvents.push({ at: now, node: n.id, kind: n.status === 'idle' ? 'ok' : n.status, text: `${n.label} ${word}${n.why ? ` · ${n.why}` : ''}` });
      }
    }
    prevStatus = new Map(nodes.map((n) => [n.id, n.status]));
    while (mapEvents.length > 60) mapEvents.shift();
    return { title: 'Parcel lab', nodes, links, events: mapEvents.slice(), generatedAt: now };
  }

  function mapAmbient(now) {
    const r = Math.random();
    if (!incident && r < 0.012) {
      incident = { node: 'api', until: now + 25e3, why: 'p95 latency 1.8 s over the last minute', sub: '200 · 1840 ms' };
      mapEvents.push({ at: now, node: 'api', kind: 'warn', text: 'api is degraded · p95 latency 1.8 s' });
    } else if (r < 0.06) mapEvents.push({ at: now, link: 'db>store', kind: 'ok', text: 'db → backup · WAL segment shipped' });
    else if (r < 0.09) mapEvents.push({ at: now, link: 'runner-1>preview', kind: 'working', text: `preview deploy · ${pick(W.lanes).branch}` });
    else if (r < 0.11) mapEvents.push({ at: now, link: 'status>web', kind: 'ok', text: `uptime check · web 200 · ${probe.web} ms` });
  }

  // History so the Map ticker is not empty on arrival.
  mapEvents.push(
    { at: t0 - 22 * MIN, node: 'backup', kind: 'ok', text: 'nightly backup finished · 6 rooms, 41 GB' },
    { at: t0 - 9 * MIN, node: 'lane:flaky-e2e', kind: 'ok', text: 'flaky-e2e finished · PR #409 green' },
  );

  // ------------------------------------------------------------ sockets

  const RealWS = window.WebSocket;
  const sockets = new Set();

  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url; this.readyState = 0; this.binaryType = 'blob';
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      setTimeout(() => { this.readyState = 1; this._emit('open'); this.opened(); }, 60);
    }
    _emit(type, init = {}) {
      const ev = type === 'message' ? new MessageEvent('message', init) : new Event(type);
      this.dispatchEvent(ev);
      this[`on${type}`]?.(ev);
    }
    deliver(data) { if (this.readyState === 1) this._emit('message', { data }); }
    close() { if (this.readyState > 1) return; this.readyState = 3; this.closed?.(); this._emit('close'); }
    send() {}
  }
  FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;

  class MainSocket extends FakeSocket {
    opened() {
      sockets.add(this);
      const now = Date.now();
      this.deliver(JSON.stringify({ type: 'snapshot', sessions: sessionList(), lanes: lanes(), vitals: vitals(now), attention: attention(), box: box(now), generatedAt: now }));
      this.deliver(JSON.stringify({ type: 'map', map: mapModel(now) }));
    }
    closed() { sockets.delete(this); }
  }

  class TermSocket extends FakeSocket {
    opened() {
      this.session = decodeURIComponent(this.url.split('/ws/term/')[1].split('?')[0]);
      const q = new URL(this.url.replace(/^ws/, 'http')).searchParams;
      this.deliver(JSON.stringify({ type: 'size', cols: Number(q.get('cols')) || 120, rows: Number(q.get('rows')) || 36, session: this.session, pinned: false }));
      const lines = log.get(this.session) ?? ['\x1b[2m(no session)\x1b[0m'];
      this.write('\x1b[2J\x1b[H' + lines.join('\r\n') + '\r\n');
      listeners.add(this);
    }
    write(text) { this.deliver(new TextEncoder().encode(text).buffer); }
    send(raw) {
      if (this._told) return;
      try { if (JSON.parse(raw).type !== 'data') return; } catch { return; }
      this._told = true;
      this.write('\r\n\x1b[33m(demo: this terminal is a recording, keystrokes go nowhere)\x1b[0m\r\n');
    }
    closed() { listeners.delete(this); }
  }

  window.WebSocket = function DemoWebSocket(url, protocols) {
    const u = String(url);
    if (u.includes('/ws/term/')) return new TermSocket(u);
    if (/\/ws(\?|$)/.test(u)) return new MainSocket(u);
    return new RealWS(url, protocols);
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

  const send = (msg) => { const data = JSON.stringify(msg); for (const s of sockets) s.deliver(data); };

  // ------------------------------------------------------------ the loop

  let lastBox = 0, lastMap = 0;
  setInterval(() => {
    const now = Date.now();
    const events = advance(now);
    limits(now);
    const finished = tickCi(now);
    if (finished) mapEvents.push({ at: now, link: 'runner-1>preview', kind: finished.conclusion === 'success' ? 'ok' : 'crit', text: `CI ${finished.conclusion} · ${finished.branch}` });
    mapAmbient(now);
    send({ type: 'delta', generatedAt: now, sessions: sessionList(), attention: attention(), lanes: lanes(), vitals: vitals(now),
      ...(now - lastBox > 8000 ? { box: box(now) } : {}) });
    if (now - lastBox > 8000) lastBox = now;
    for (const e of events) send({ type: 'event', event: e });
    if (now - lastMap > 1900) { lastMap = now; send({ type: 'map', map: mapModel(now) }); }
  }, 2000);

  // ------------------------------------------------------------ /api

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const refuse = (what) => { note(`Demo: ${what}. Nothing runs here.`); return json({ error: `read-only demo: ${what}` }, 403); };

  function morning(windowName, now) {
    const since = { '12h': now - 12 * H, tonight: now - 9 * H, '24h': now - 24 * H, '7d': now - 7 * 24 * H }[windowName] ?? now - 9 * H;
    const hueOf = (id) => W.lanes.find((l) => l.id === id)?.hue ?? 200;
    const needsYou = [
      ...attention().map((a) => ({ source: 'attention', id: `attention:${a.name}`, name: a.name, lane: a.name, hue: hueOf(a.name), state: a.state, at: a.since, kind: a.state,
        text: sessions.get(a.name)?._lane.question ?? (a.state === 'done' ? 'finished its stage' : `approve: ${sessions.get(a.name)?.activity.toolInput ?? 'a command'}`) })),
      ...[...sessions.values()].filter((s) => s.lastMarker && ['need', 'blocked'].includes(s.lastMarker.kind))
        .map((s) => ({ source: 'marker', id: `marker:${s.lastMarker.id}`, markerId: s.lastMarker.id, name: s.name, lane: s.lane, hue: hueOf(s.lane), state: s.state, at: s.lastMarker.ts, kind: s.lastMarker.kind, text: s.lastMarker.text })),
    ];
    const lanesNow = lanes();
    const finished = lanesNow.filter((l) => l.progress?.n).map((l) => {
      const w = W.lanes.find((x) => x.id === l.id);
      const pr = prs()[l.id];
      return { lane: l.id, hue: l.hue, branch: l.branch, merged: false, isMain: false, idle: l.idle, progress: l.progress, lastCommitAt: l.lastCommitAt, newCommit: true,
        doneMarkers: [{ id: 900 + l.hue, ts: now - rnd(1, 8) * H, text: `STAGE-DONE ${l.progress.n}: ${w.stage >= w.stages ? 'final stage' : 'stage ' + l.progress.n}`, session: l.id }],
        pr: pr?.number ? pr : null, sessions: sessions.has(l.id) ? [{ name: l.id, state: sessions.get(l.id).state, since: sessions.get(l.id).stateSince }] : [] };
    });
    const costLanes = [...sessions.values()].map((s) => ({ lane: s.lane, usd: +s.cost.usdToday.toFixed(2), tokens: Math.round(s.cost.usdToday * 180000), sessions: [s.name], hue: hueOf(s.lane) }))
      .sort((a, b) => b.usd - a.usd);
    return { window: windowName, label: windowName === 'tonight' ? 'since 22:00' : `last ${windowName}`, since, now, needsYou, finished,
      cost: { lanes: costLanes, totalUsd: +costLanes.reduce((a, l) => a + l.usd, 0).toFixed(2), totalTokens: costLanes.reduce((a, l) => a + l.tokens, 0), label: 'API-equivalent' },
      rateLimits: limits(now) };
  }

  function credit(now) {
    const series = (span, step, windowMs, start, climb, target) => {
      const points = [], resets = [];
      let v = start, resetAt = now - span + windowMs * 0.4;
      for (let t = now - span; t <= now; t += step) {
        if (t >= resetAt) { resets.push(resetAt); v = rnd(0, 3); resetAt += windowMs; }
        const hour = new Date(t).getHours();
        v = Math.min(99, v + (hour >= 8 && hour <= 23 ? climb * rnd(0.3, 1.6) : climb * 0.1));
        points.push({ t, v });
      }
      // Scale the last stretch so the line ends where the header says it is.
      const end = points.at(-1).v || 1;
      const since = resets.at(-1) ?? now - span;
      for (const p of points) if (p.t >= since) p.v = p.v * (target / end);
      for (const p of points) p.v = +Math.min(99, p.v).toFixed(1);
      return { points, resets };
    };
    const hueOf = (id) => W.lanes.find((l) => l.id === id)?.hue ?? 200;
    const rows = W.lanes.map((l) => {
      const s = sessions.get(l.id);
      const day = s ? s.cost.usdToday : rnd(0, 2);
      return { lane: l.id, hue: hueOf(l.id), tonight: +(day * 0.7).toFixed(2), day: +day.toFixed(2), week: +(day * rnd(3, 6)).toFixed(2), allTime: +(s ? s.cost.usd : rnd(4, 20)).toFixed(2),
        tokens: { input: Math.round(day * 40000), output: Math.round(day * 22000), cacheRead: Math.round(day * 900000), cacheWrite: Math.round(day * 60000) } };
    });
    const sum = (k) => +rows.reduce((a, r) => a + r[k], 0).toFixed(2);
    return {
      now,
      charts: {
        sevenDay: { title: '7-day window', since: now - 7 * 24 * H, now, ...series(7 * 24 * H, H, 7 * 24 * H * 10, 18, 0.35, Math.round(seven.usedPct)) },
        fiveHour: { title: '5-hour window', since: now - 24 * H, now, ...series(24 * H, 10 * MIN, 5 * H, 4, 1.6, Math.round(five.usedPct)) },
      },
      lanes: rows, totals: { tonight: sum('tonight'), day: sum('day'), week: sum('week'), allTime: sum('allTime') },
      rateLimits: limits(now), sampler: { rows: 4180, lastSampleAt: now - 40e3, lastSampleAgeMs: 40e3 }, label: 'API-equivalent',
    };
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const i = url.pathname.indexOf('/api/');
    if (i < 0) return realFetch(input, init);
    const p = url.pathname.slice(i);
    const method = (init.method ?? 'GET').toUpperCase();
    const now = Date.now();
    if (method === 'GET') {
      if (p === '/api/morning') return json(morning(url.searchParams.get('window') ?? 'tonight', now));
      if (p === '/api/credit') return json(credit(now));
      if (p === '/api/map') return json(mapModel(now));
      if (p === '/api/state') return json({ sessions: sessionList(), lanes: lanes(), vitals: vitals(now), attention: attention(), box: box(now), generatedAt: now });
      if (p === '/api/lanes') {
        const b = box(now);
        return json({ lanes: lanes(), launched: b.launched, jobs: [], readiness: b.readiness, ci: { prs: b.prs, queue: b.ci.queue, auth: b.ci.auth, refreshedAt: now, provider: 'gh' }, generatedAt: now });
      }
      if (p === '/api/push/key') return refuse('notifications need a real install');
      return json({ error: 'not found in the demo' }, 404);
    }
    if (p === '/api/client-metrics') return json({ ok: true });
    const marker = /^\/api\/markers\/(\d+)$/.exec(p);
    if (method === 'DELETE' && marker) {
      for (const s of sessions.values()) if (s.lastMarker?.id === Number(marker[1])) s.lastMarker = null;
      return json({ ok: true, id: Number(marker[1]) });
    }
    if (p === '/api/lanes') return refuse('launching a lane needs a real install');
    if (/\/api\/sessions\//.test(p)) return refuse('sessions here are recordings');
    return refuse('this action needs a real install');
  };

  // No worker on a demo origin: it would outlive the page.
  if (navigator.serviceWorker) {
    try { navigator.serviceWorker.register = () => Promise.reject(new Error('demo: no service worker')); } catch { /* read-only in some browsers */ }
  }

  // ------------------------------------------------------------ the frame

  function note(text) {
    const el = document.getElementById('demo-note');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(note.t);
    note.t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      .demo-flag{position:fixed;right:12px;bottom:12px;z-index:50;display:flex;gap:10px;align-items:center;padding:6px 8px 6px 12px;
        border:1px solid var(--border-strong);border-radius:999px;background:var(--glass-fill-strong);box-shadow:var(--shadow-float);
        font:11px var(--font-mono);color:var(--text-2)}
      .demo-flag b{color:var(--warn);font-weight:600;letter-spacing:.08em}
      .demo-flag a{color:var(--text-1);text-decoration:none;padding:3px 9px;border-radius:999px;background:oklch(92% 0.01 258 / .08)}
      .demo-flag a:hover{background:oklch(92% 0.01 258 / .16)}
      .demo-note{position:fixed;left:50%;bottom:56px;transform:translateX(-50%);z-index:60;padding:8px 14px;border-radius:4px;
        background:var(--glass-fill-strong);border:1px solid var(--border-strong);color:var(--text-1);font:12px var(--font-mono);box-shadow:var(--shadow-float)}
      @media (max-width:699px){.demo-flag{bottom:calc(60px + env(safe-area-inset-bottom));right:8px}}`;
    document.head.append(style);
    const flag = document.createElement('div');
    flag.className = 'demo-flag';
    flag.innerHTML = '<b>DEMO</b><span>a simulated lab, 8 lanes</span>';
    // On GitHub Pages the repo is <owner>.github.io/<repo>: link back to it.
    if (location.hostname.endsWith('.github.io')) {
      const a = document.createElement('a');
      a.href = `https://github.com/${location.hostname.split('.')[0]}/${location.pathname.split('/')[1] || 'laneboard'}`;
      a.textContent = 'Install it ↗';
      a.target = '_blank';
      a.rel = 'noopener';
      flag.append(a);
    }
    const n = document.createElement('div');
    n.className = 'demo-note';
    n.id = 'demo-note';
    n.hidden = true;
    document.body.append(flag, n);
  });
})();
