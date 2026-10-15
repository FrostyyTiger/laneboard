// The command registry (fleet plan §4 2.6, task D8). Hotkeys (ui/hotkeys.js)
// and the palette (ui/palette.js) both read from it, so a key and a palette
// row always run the same code.
//
//   register({id, title, icon, keys?, when?(ctx), run(ctx), tier?, type?, sub?})
//   list(ctx)      -> the commands whose when(ctx) holds, in registration order
//   run(id, ctx)   -> {ok:true, value} | {ok:false, reason}
//
// Pure: no DOM, no store. `ctx` is whatever the caller builds (the hotkeys
// pass {view, route, store, ...}); a `when` that throws counts as false and a
// `run` that throws is reported, never rethrown into a key handler.
//
// A command with a `tier` other than read/click names an action that needs
// the confirm dialog (ui/confirm.js). The registry never sends an action
// itself: such a command's run() goes through confirmAction() and act()
// (ui/palette.js runAction), and nothing here bypasses that.

const ID_RX = /^[a-z][a-z0-9:._-]{0,63}$/;
const TIERS = new Set(['read', 'click', 'ask', 'confirm']);

/** A fresh registry. The page uses the default one below; tests make their own. */
export function createRegistry() {
  const cmds = new Map();

  function register(cmd) {
    if (!cmd || typeof cmd !== 'object') throw new TypeError('register: a command object is required');
    const { id, run } = cmd;
    if (typeof id !== 'string' || !ID_RX.test(id)) throw new TypeError(`register: bad command id ${JSON.stringify(String(id).slice(0, 40))}`);
    if (typeof run !== 'function') throw new TypeError(`register: ${id} needs run()`);
    if (cmd.when !== undefined && typeof cmd.when !== 'function') throw new TypeError(`register: ${id} when must be a function`);
    if (cmd.tier !== undefined && cmd.tier !== null && !TIERS.has(cmd.tier)) throw new TypeError(`register: ${id} has an unknown tier`);
    const entry = Object.freeze({
      id,
      title: typeof cmd.title === 'string' && cmd.title ? cmd.title : id,
      icon: typeof cmd.icon === 'string' ? cmd.icon : 'command',
      keys: Array.isArray(cmd.keys) ? Object.freeze(cmd.keys.map(String)) : typeof cmd.keys === 'string' ? Object.freeze([cmd.keys]) : Object.freeze([]),
      when: cmd.when ?? null,
      run,
      tier: cmd.tier ?? null,
      type: typeof cmd.type === 'string' ? cmd.type : 'ACT',
      sub: typeof cmd.sub === 'string' ? cmd.sub : '',
      palette: cmd.palette !== false,
    });
    // Re-registering an id replaces it (a view module loaded twice, a hot swap).
    cmds.delete(id);
    cmds.set(id, entry);
    return () => { if (cmds.get(id) === entry) cmds.delete(id); };
  }

  function unregister(id) {
    return cmds.delete(id);
  }

  function get(id) {
    return cmds.get(id) ?? null;
  }

  function available(cmd, ctx) {
    if (!cmd.when) return true;
    try { return Boolean(cmd.when(ctx ?? {})); } catch { return false; }
  }

  /** The commands available in `ctx`, in registration order. */
  function list(ctx) {
    return [...cmds.values()].filter((c) => available(c, ctx));
  }

  /**
   * Run `id` in `ctx`. Unknown or unavailable ids do nothing. The value of
   * run() is returned as is (a promise for an action command).
   */
  function run(id, ctx) {
    const cmd = cmds.get(id);
    if (!cmd) return { ok: false, reason: 'unknown' };
    if (!available(cmd, ctx)) return { ok: false, reason: 'unavailable' };
    try {
      return { ok: true, value: cmd.run(ctx ?? {}) };
    } catch (err) {
      return { ok: false, reason: 'error', error: String(err?.message ?? err) };
    }
  }

  function clear() {
    cmds.clear();
  }

  return { register, unregister, get, list, run, clear, has: (id) => cmds.has(id) };
}

const page = createRegistry();

export const register = page.register;
export const unregister = page.unregister;
export const get = page.get;
export const list = page.list;
export const run = page.run;
export const has = page.has;
