// Live terminal surface: xterm.js over /ws/term/<name>.
//
// Sizing is negotiated with the server (see server/terminals.mjs):
//   * normally the fit addon measures the container and the pty takes that
//     size, so the tmux pane re-flows to the browser's width (plan §5);
//   * if a human is attached to that session in their own terminal the server
//     answers {pinned:true} with ITS geometry, and we CSS-scale to fit instead
//     of resizing, so we never disturb someone who is looking at the session.

const views = new Map(); // name -> view
let xtermLoading = null;

const THEME = {
  background: '#0a0d11',
  foreground: '#abb2bf',
  cursor: '#55a8f5',
  cursorAccent: '#0a0d11',
  selectionBackground: 'rgba(85,168,245,.28)',
  black: '#3b4048', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#ef7a85', brightGreen: '#b5e08a', brightYellow: '#f5d68b',
  brightBlue: '#7cc0ff', brightMagenta: '#d99ae8', brightCyan: '#6fd3de', brightWhite: '#e6e9ef',
};

/** xterm ships as UMD, so load it once via a script tag and read the globals. */
function loadXterm() {
  if (window.Terminal) return Promise.resolve();
  if (xtermLoading) return xtermLoading;
  xtermLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/xterm.js';
    s.onload = () => {
      let pending = 2;
      const done = () => { if (--pending === 0) resolve(); };
      for (const src of ['/vendor/addon-fit.js', '/vendor/addon-web-links.js']) {
        const a = document.createElement('script');
        a.src = src;
        a.onload = done;
        a.onerror = done; // both addons are niceties, not requirements
        document.head.append(a);
      }
    };
    s.onerror = () => reject(new Error('failed to load xterm.js'));
    document.head.append(s);
  });
  return xtermLoading;
}

function statusLine(host, text) {
  let n = host.querySelector('.term-status');
  if (!n) {
    n = document.createElement('div');
    n.className = 'term-status';
    n.style.cssText =
      'position:absolute;inset:auto 0 0 0;padding:4px 8px;font:11px var(--mono);' +
      'color:var(--fg-faint);background:color-mix(in srgb,var(--bg-inset) 88%,transparent);';
    host.append(n);
  }
  n.textContent = text;
  n.hidden = !text;
}

export async function openTerminal(name, host) {
  closeTerminal(name);
  host.textContent = '';
  host.style.position = 'relative';
  host.style.overflow = 'hidden';

  const view = {
    name, host, term: null, ws: null, closed: false, wrap: null, fit: null,
    pinned: false, cols: 80, rows: 24, backoff: 400, retryTimer: null, everConnected: false,
  };
  views.set(name, view);

  try {
    await loadXterm();
  } catch {
    statusLine(host, 'could not load the terminal library');
    return;
  }
  if (view.closed) return;

  // A wrapper we can CSS-scale without xterm noticing.
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;transform-origin:top left;';
  host.append(wrap);
  view.wrap = wrap;

  const term = new window.Terminal({
    cols: 80,
    rows: 24,
    fontSize: 13,
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
    lineHeight: 1.15,
    theme: THEME,
    cursorBlink: true,
    scrollback: 2000,
    allowProposedApi: true,
    convertEol: false,
    // The terminal background stays opaque (allowTransparency is left off on
    // purpose — it costs performance and there is never glass under a live
    // pane), and dim ANSI colours are lifted to a readable contrast against it.
    minimumContrastRatio: 4.5,
  });
  view.term = term;
  term.open(wrap);
  if (window.WebLinksAddon?.WebLinksAddon) {
    try { term.loadAddon(new window.WebLinksAddon.WebLinksAddon()); } catch { /* optional */ }
  }
  if (window.FitAddon?.FitAddon) {
    try {
      view.fit = new window.FitAddon.FitAddon();
      term.loadAddon(view.fit);
    } catch { view.fit = null; }
  }

  term.onData((data) => {
    if (view.ws?.readyState === WebSocket.OPEN) view.ws.send(JSON.stringify({ type: 'data', data }));
  });

  let resizeTimer = null;
  view.ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => rescale(view), 120);
  });
  view.ro.observe(host);

  connect(view);
}

/**
 * Open (or re-open) the socket. A server restart kills every grouped session,
 * so a dock tile must rebuild itself rather than sit there dead — the pin is
 * kept and the grouped session is simply created again.
 */
function connect(view) {
  if (view.closed) return;
  clearTimeout(view.retryTimer);

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Ask for the size the container can actually show, so the pane arrives
  // already wide instead of re-flowing a moment later.
  const want = proposeDims(view);
  const qs = want ? `?cols=${want.cols}&rows=${want.rows}` : '';
  const ws = new WebSocket(`${proto}//${location.host}/ws/term/${encodeURIComponent(view.name)}${qs}`);
  ws.binaryType = 'arraybuffer';
  view.ws = ws;
  statusLine(view.host, view.everConnected ? 'reconnecting…' : 'connecting…');

  ws.addEventListener('open', () => {
    view.everConnected = true;
    view.backoff = 400;
    statusLine(view.host, '');
  });
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'size') {
        view.pinned = Boolean(msg.pinned);
        applySize(view, msg.cols, msg.rows);
      }
      return;
    }
    view.term?.write(new Uint8Array(ev.data));
  });
  ws.addEventListener('close', () => retry(view));
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* already closing */ } });
}

function retry(view) {
  if (view.closed) return;
  view.ws = null;
  statusLine(view.host, `reconnecting in ${Math.round(view.backoff / 1000) || 1}s…`);
  view.retryTimer = setTimeout(() => connect(view), view.backoff);
  view.backoff = Math.min(Math.round(view.backoff * 1.7), 15000);
}

/** What the container could show at the current font size. */
function proposeDims(view) {
  if (!view.fit) return null;
  try {
    const d = view.fit.proposeDimensions();
    if (!d || !Number.isFinite(d.cols) || !Number.isFinite(d.rows)) return null;
    return { cols: Math.max(20, d.cols), rows: Math.max(5, d.rows) };
  } catch {
    return null;
  }
}

function applySize(view, cols, rows) {
  if (!view.term || view.closed) return;
  if (cols !== view.cols || rows !== view.rows) {
    view.cols = cols;
    view.rows = rows;
    try { view.term.resize(cols, rows); } catch { /* term is going away */ }
  }
  rescale(view);
}

/**
 * Free mode: ask the server for the size the container can show.
 * Pinned mode: leave the pty alone and CSS-scale the fixed grid to fit.
 */
function rescale(view) {
  if (!view.wrap || view.closed) return;

  if (!view.pinned) {
    view.wrap.style.transform = '';
    const want = proposeDims(view);
    if (want && (want.cols !== view.cols || want.rows !== view.rows)) {
      if (view.ws?.readyState === WebSocket.OPEN) {
        view.ws.send(JSON.stringify({ type: 'resize', cols: want.cols, rows: want.rows }));
      }
    }
    return;
  }

  const screen = view.wrap.querySelector('.xterm-screen');
  if (!screen) return;
  const w = screen.offsetWidth;
  const h = screen.offsetHeight;
  if (!w || !h) return;
  const box = view.host.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const k = Math.min(box.width / w, box.height / h);
  // Never upscale past 1.6x — a 90-column pane blown up looks broken.
  view.wrap.style.transform = `scale(${Math.min(k, 1.6).toFixed(3)})`;
}

export function closeTerminal(name) {
  const view = views.get(name);
  if (!view) return;
  view.closed = true;
  views.delete(name);
  clearTimeout(view.retryTimer);
  try { view.ro?.disconnect(); } catch { /* not observing */ }
  try { view.ws?.close(); } catch { /* already closing */ }
  try { view.term?.dispose(); } catch { /* already disposed */ }
  if (view.host) view.host.textContent = '';
}

export function fitAll() {
  for (const view of views.values()) rescale(view);
}

/** Type into a live terminal, used by the phone quick-bar. */
export function writeTo(name, data) {
  const view = views.get(name);
  if (view?.ws?.readyState === WebSocket.OPEN) {
    view.ws.send(JSON.stringify({ type: 'data', data }));
    return true;
  }
  return false;
}

export function isLive(name) {
  return views.get(name)?.ws?.readyState === WebSocket.OPEN;
}
