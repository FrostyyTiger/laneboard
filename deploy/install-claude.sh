#!/usr/bin/env bash
# Wire ~/.claude to the laneboard: hooks, the pause gate and the status line.
#
#   deploy/install-claude.sh [--dry-run]                  install / re-install
#   deploy/install-claude.sh --uninstall [--statusline] [--dry-run]
#
# Install:
#  - backs up ~/.claude/settings.json first (~/.claude/backups/settings.json.<stamp>);
#  - renders deploy/hooks.json.tmpl from server/config.mjs (port, stateDir,
#    approvals.holdSec) and merges it PER EVENT: in each event only the hook
#    entries marked as laneboard's (`ours` below) are replaced; every other
#    hook a user has stays where it is, byte for byte;
#  - sets .statusLine only if there is none;
#  - copies deploy/hooks/gate.sh to ~/.claude/laneboard/gate.sh (0755) and
#    creates the PermissionRequest hook token (node server/control/token.mjs);
#  - installs the status line, or appends the sidecar to an existing one.
# Two guards run before anything is written: everything outside .hooks and
# .statusLine is unchanged, and the non-laneboard hook entries (and groups)
# are identical before and after. If either fails nothing is written, exit 1.
# Re-running is a no-op apart from a fresh backup.
#
# --uninstall: back up, strip laneboard's entries, drop events that end up
# empty, remove the status-line sidecar and ~/.claude/laneboard/. .statusLine
# is left alone unless it points at ~/.claude/statusline-command.sh and
# --statusline is given (the script itself is removed only if it is our
# unmodified copy).
#
# --dry-run: print the settings diff and change nothing (no backup, no token,
# no copies).
#
# Ownership marker: a hook entry is laneboard's when its command (or url)
# posts to 127.0.0.1:<port>/api/hook... or runs something under
# .claude/laneboard/.
#
# Template placeholders (deploy/hooks.json.tmpl, valid JSON):
#   @PORT@          config.port
#   @HOLD@          curl -m for the PermissionRequest hold: approvals.holdSec + 5,
#                   so the server's own timeout answer still arrives
#   "@HOLD_TIMEOUT@" the hook timeout in seconds (a number): @HOLD@ + 15
#   @STATE_DIR@     config.stateDir, as a single-quoted shell word
#   @HEADER_FILE@   <stateDir>/hook.header, as a single-quoted shell word
set -euo pipefail

usage() { sed -n '4,5p' "${BASH_SOURCE[0]}" | sed 's/^# *//'; }

MODE=install DRY=0 STATUSLINE=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --uninstall) MODE=uninstall ;;
    --statusline) STATUSLINE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $a" >&2; usage >&2; exit 2 ;;
  esac
done
if [ "$STATUSLINE" = 1 ] && [ "$MODE" != uninstall ]; then
  echo "--statusline only goes with --uninstall" >&2; exit 2
fi
command -v jq >/dev/null 2>&1 || { echo "install-claude: jq is required" >&2; exit 1; }

REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
NODE="${LANEBOARD_NODE:-$(command -v node || echo /usr/bin/node)}"
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
BACKUPS="$CLAUDE_DIR/backups"
OURDIR="$CLAUDE_DIR/laneboard"
TMPL="$REPO/deploy/hooks.json.tmpl"
# Write through a symlinked settings.json (dotfile repos) instead of replacing the link.
[ -L "$SETTINGS" ] && SETTINGS="$(readlink -f "$SETTINGS")"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Shared jq definitions. `ours` is the ownership marker; `strip` removes our
# entries, drops groups we emptied and events we emptied, and touches nothing
# else (an event or group without our entries is returned as is).
JQ_DEFS='
def ours: type == "object" and (((.command // .url // "") | tostring)
  | test("127\\.0\\.0\\.1:[0-9]+/api/hook|\\.claude/laneboard/"));
def hasours: type == "object" and ((.hooks | type) == "array") and any(.hooks[]; ours);
def stripev: map(if hasours then (.hooks |= map(select(ours | not))) | select(.hooks | length > 0) else . end);
def strip:
  if (.hooks | type) == "object" then
    .hooks |= (to_entries
      | map(if (.value | type) == "array" and any(.value[]; hasours)
            then (.value |= stripev) | select(.value | length > 0) else . end)
      | from_entries)
  else . end;
# Independent of strip: the foreign hook entries and the foreign groups, with their event.
def foreign_entries: [(.hooks // {}) | objects | to_entries[] | .key as $k | .value | arrays | .[]
  | objects | (del(.hooks)) as $g | .hooks | arrays | .[] | select(ours | not) | {ev: $k, g: $g, h: .}] | sort;
def foreign_groups: [(.hooks // {}) | objects | to_entries[] | .key as $k | .value | arrays | .[]
  | (if hasours then (.hooks |= map(select(ours | not))) | select(.hooks | length > 0) else . end)
  | {ev: $k, g: .}] | sort;
'

# ---- the current settings ---------------------------------------------------
BEFORE="$WORK/before.json"
if [ -f "$SETTINGS" ]; then
  jq -e 'type == "object"' "$SETTINGS" >/dev/null 2>&1 \
    || { echo "install-claude: $SETTINGS is not a JSON object; fix it first" >&2; exit 1; }
  cp "$SETTINGS" "$BEFORE"
else
  echo '{}' > "$BEFORE"
fi
jq -e '(.hooks == null) or ((.hooks | type) == "object" and all(.hooks[]; type == "array"))' "$BEFORE" >/dev/null \
  || { echo "install-claude: .hooks in $SETTINGS has an unexpected shape; refusing" >&2; exit 1; }

backup() {
  [ -f "$SETTINGS" ] || return 0
  mkdir -p "$BACKUPS"
  local base n=0 dest
  base="$BACKUPS/settings.json.$(date -u +%Y-%m-%dT%H-%M-%S.%NZ)"
  dest="$base"
  while [ -e "$dest" ]; do n=$((n + 1)); dest="$base.$n"; done
  cp -p "$SETTINGS" "$dest"
  echo "backed up settings.json -> $dest"
}

# ---- render the template ------------------------------------------------------
render() {
  local cfg port sd hold hdr
  cfg=$(cd "$REPO" && "$NODE" --input-type=module -e '
    const { config: c } = await import("./server/config.mjs");
    console.log(JSON.stringify({ port: c.port, stateDir: c.stateDir, holdSec: c.approvals?.holdSec ?? 600 }));
  ' </dev/null) || { echo "install-claude: cannot read the laneboard config" >&2; return 1; }
  port=$(jq -r '.port' <<<"$cfg"); sd=$(jq -r '.stateDir' <<<"$cfg"); hold=$(jq -r '.holdSec' <<<"$cfg")
  [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] \
    || { echo "install-claude: bad port in config: $port" >&2; return 1; }
  [[ "$hold" =~ ^[0-9]+$ ]] || { echo "install-claude: bad approvals.holdSec: $hold" >&2; return 1; }
  case "$sd" in /*) ;; *) echo "install-claude: stateDir must be absolute: $sd" >&2; return 1 ;; esac
  if [ "$DRY" = 1 ]; then
    hdr="$sd/hook.header"
  else
    hdr=$(cd "$REPO" && "$NODE" server/control/token.mjs "$sd" </dev/null) \
      || { echo "install-claude: cannot create the hook token" >&2; return 1; }
  fi
  hold=$((hold + 5))
  jq --arg port "$port" --arg hold "$hold" --arg ht "$((hold + 15))" --arg sd "$sd" --arg hdr "$hdr" '
    def sq: "'"'"'" + gsub("'"'"'"; "'"'"'\\'"'"''"'"'") + "'"'"'";
    walk(if type == "string" then
      (if . == "@HOLD_TIMEOUT@" then ($ht | tonumber)
       else gsub("@PORT@"; $port) | gsub("@HOLD@"; $hold)
          | gsub("@STATE_DIR@"; $sd | sq) | gsub("@HEADER_FILE@"; $hdr | sq) end)
    else . end)
  ' "$TMPL" > "$WORK/hooks.json"
  if grep -q '@[A-Z_]*@' "$WORK/hooks.json"; then
    echo "install-claude: unrendered placeholder in $TMPL" >&2; return 1
  fi
  # Every rendered entry must carry the marker, or a re-install would duplicate it.
  jq -e "$JQ_DEFS"' all(.[][]; .hooks | all(.[]; ours))' "$WORK/hooks.json" >/dev/null \
    || { echo "install-claude: a template entry lacks the laneboard marker" >&2; return 1; }
}

# ---- compute the new settings --------------------------------------------------
AFTER="$WORK/after.json"
if [ "$MODE" = install ]; then
  render
  jq --slurpfile h "$WORK/hooks.json" "$JQ_DEFS"'
    strip
    | .hooks = (reduce ($h[0] | keys_unsorted[]) as $ev ((.hooks // {}); .[$ev] = ((.[$ev] // []) + $h[0][$ev])))
    | .statusLine = (.statusLine // {type: "command", command: "~/.claude/statusline-command.sh"})
  ' "$BEFORE" > "$AFTER"
else
  jq --argjson sl "$STATUSLINE" "$JQ_DEFS"'
    ((.hooks | type) == "object" and (.hooks | length) > 0) as $had
    | strip
    | if $had and .hooks == {} then del(.hooks) else . end
    | if $sl == 1 and ((.statusLine.command? // "") | test("^(~|\\$HOME)/\\.claude/statusline-command\\.sh$"))
      then del(.statusLine) else . end
  ' "$BEFORE" > "$AFTER"
fi

# ---- guards ---------------------------------------------------------------------
fail_guard() { echo "refusing: $1; $SETTINGS left unchanged" >&2; exit 1; }
cmp -s <(jq -S 'del(.hooks, .statusLine)' "$BEFORE") <(jq -S 'del(.hooks, .statusLine)' "$AFTER") \
  || fail_guard "the merge changed more than .hooks and .statusLine"
cmp -s <(jq -c "$JQ_DEFS"' foreign_entries' "$BEFORE") <(jq -c "$JQ_DEFS"' foreign_entries' "$AFTER") \
  || fail_guard "the merge changed hook entries that are not laneboard's"
cmp -s <(jq -c "$JQ_DEFS"' foreign_groups' "$BEFORE") <(jq -c "$JQ_DEFS"' foreign_groups' "$AFTER") \
  || fail_guard "the merge changed hook groups that are not laneboard's"
sl_ok=$(jq -n --slurpfile b "$BEFORE" --slurpfile a "$AFTER" --arg m "$MODE" '
  ($b[0].statusLine) as $x | ($a[0].statusLine) as $y
  | $x == $y or ($m == "install" and $x == null) or ($m == "uninstall" and $y == null)')
[ "$sl_ok" = true ] || fail_guard "the merge changed an existing .statusLine"
if [ "$MODE" = uninstall ]; then
  jq -e "$JQ_DEFS"' [.hooks // {} | .[][]? | select(hasours)] | length == 0' "$AFTER" >/dev/null \
    || fail_guard "laneboard entries survived the uninstall"
fi

summary() {
  jq -r "$JQ_DEFS"'
    (.hooks // {}) | to_entries[] | .key as $k
    | [.value[]? | .hooks[]?] as $e
    | "  \($k): \([$e[] | select(ours)] | length) laneboard, \([$e[] | select(ours | not)] | length) other"
  ' "$1"
}

if [ "$DRY" = 1 ]; then
  echo "dry run ($MODE): changes to $SETTINGS"
  diff -u --label settings.json --label settings.json.new <(jq . "$BEFORE") "$AFTER" || true
  summary "$AFTER"
  exit 0
fi

# ---- write ------------------------------------------------------------------------
backup
mkdir -p "$(dirname "$SETTINGS")"
if [ -f "$SETTINGS" ] && cmp -s "$SETTINGS" "$AFTER"; then
  echo "settings.json already up to date"
else
  tmp=$(mktemp "$(dirname "$SETTINGS")/.settings.XXXXXX")
  cat "$AFTER" > "$tmp"
  [ -f "$SETTINGS" ] && chmod --reference="$SETTINGS" "$tmp" 2>/dev/null || true
  mv "$tmp" "$SETTINGS"
  echo "wrote $SETTINGS"
fi
summary "$SETTINGS"

cd "$REPO"
if [ "$MODE" = install ]; then
  mkdir -p "$OURDIR"
  tmp=$(mktemp "$OURDIR/.gate.XXXXXX")
  cat "$REPO/deploy/hooks/gate.sh" > "$tmp"
  chmod 0755 "$tmp"
  mv "$tmp" "$OURDIR/gate.sh"
  echo "installed $OURDIR/gate.sh"
  "$NODE" --input-type=module -e "
    const sl = await import('./server/collector/statusline.mjs');
    console.log('statusline:', JSON.stringify(await sl.ensureStatusline()));
  " </dev/null
else
  rm -rf -- "$OURDIR"
  echo "removed $OURDIR"
  STATUSLINE="$STATUSLINE" "$NODE" --input-type=module -e "
    import fs from 'node:fs';
    import path from 'node:path';
    const { config } = await import('./server/config.mjs');
    const sl = await import('./server/collector/statusline.mjs');
    const file = config.statuslinePath;
    let script;
    try { script = fs.readFileSync(file, 'utf8'); } catch { console.log('statusline: none'); process.exit(0); }
    const ours = fs.readFileSync(path.join(config.repoRoot, 'deploy', 'statusline-command.sh'), 'utf8');
    if (process.env.STATUSLINE === '1' && script === ours) {
      fs.unlinkSync(file);
      console.log('statusline: removed our unmodified script');
    } else if (sl.isInstalled(script)) {
      fs.mkdirSync(config.backupsDir, { recursive: true });
      const backup = path.join(config.backupsDir, 'statusline-command.sh.' + new Date().toISOString().replace(/[:.]/g, '-'));
      fs.copyFileSync(file, backup);
      const tmp = file + '.laneboard-tmp';
      fs.writeFileSync(tmp, sl.withoutSidecar(script), { mode: fs.statSync(file).mode & 0o7777 });
      fs.renameSync(tmp, file);
      console.log('statusline: sidecar removed (backup: ' + backup + ')');
    } else {
      console.log('statusline: no sidecar');
    }
  " </dev/null
fi
