// XDG default paths for fleet state, without importing server/config.mjs (so
// config fragments can use these as defaults without an import cycle).
//
//   stateDir()   $XDG_STATE_HOME/laneboard           (fallback ~/.local/state/laneboard)
//   hubKeyFile() $XDG_CONFIG_HOME/laneboard/hub.key  (fallback ~/.config/laneboard/hub.key)
//   auditFile()  $LANEBOARD_AUDIT_FILE, else <stateDir()>/audit.jsonl
//
// $LANEBOARD_AUDIT_FILE must be absolute: a relative value would depend on
// the cwd (often / under systemd), so it is refused with an error.
//
// Per the XDG base directory spec a relative $XDG_* value is invalid and is
// ignored. Every result is an absolute path. `env` and `home` are injectable
// for tests; they default to process.env and os.homedir().
import os from 'node:os';
import path from 'node:path';

function homeDir(home) {
  const h = home ?? os.homedir();
  if (typeof h !== 'string' || !path.isAbsolute(h)) {
    throw new Error('laneboard: cannot determine an absolute home directory');
  }
  return h;
}

function xdg(env, name, home, fallback) {
  const v = env[name];
  if (typeof v === 'string' && v !== '' && path.isAbsolute(v)) return path.normalize(v);
  return path.join(homeDir(home), fallback);
}

export function stateDir({ env = process.env, home } = {}) {
  return path.join(xdg(env, 'XDG_STATE_HOME', home, '.local/state'), 'laneboard');
}

export function configDir({ env = process.env, home } = {}) {
  return path.join(xdg(env, 'XDG_CONFIG_HOME', home, '.config'), 'laneboard');
}

export function hubKeyFile(opts = {}) {
  return path.join(configDir(opts), 'hub.key');
}

export function auditFile({ env = process.env, home } = {}) {
  const v = env.LANEBOARD_AUDIT_FILE;
  if (typeof v === 'string' && v !== '') {
    if (!path.isAbsolute(v)) throw new Error('laneboard: LANEBOARD_AUDIT_FILE must be an absolute path');
    return path.normalize(v);
  }
  return path.join(stateDir({ env, home }), 'audit.jsonl');
}
