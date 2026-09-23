#!/usr/bin/env bash
# Claude Code status line, installed by the laneboard when ~/.claude has none.
# Prints one line: model · lane or dir · context % · 5 h %.
# Everything is read from the JSON Claude Code passes on stdin; nothing fails loudly.
input=$(cat)

# --- laneboard sidecar (safe to delete; nothing else depends on it) ---
# Mirrors the raw statusline stdin JSON to ~/.cache/laneboard/status/<session_id>.json
# so the laneboard can read cost, context-window and rate-limit data without
# touching any Claude Code internals. Written atomically (tmp + mv). Every
# failure is swallowed: the status line must render exactly as before.
{
  laneboard_sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
  if [ -n "$laneboard_sid" ]; then
    laneboard_dir="$HOME/.cache/laneboard/status"
    mkdir -p "$laneboard_dir" 2>/dev/null
    laneboard_tmp="$laneboard_dir/.$laneboard_sid.$$.tmp"
    if printf '%s' "$input" > "$laneboard_tmp" 2>/dev/null; then
      mv -f "$laneboard_tmp" "$laneboard_dir/$laneboard_sid.json" 2>/dev/null
    fi
    rm -f "$laneboard_tmp" 2>/dev/null
  fi
} >/dev/null 2>&1 || true
# --- end laneboard sidecar ---

model=$(printf '%s' "$input" | jq -r '.model.display_name // .model.id // "claude"' 2>/dev/null)
dir=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // empty' 2>/dev/null)
ctx=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty | floor' 2>/dev/null)
five=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty | floor' 2>/dev/null)

# The lane is the worktree's basename with the repo prefix stripped, as
# laneboard names it; outside a repo it is the directory's basename.
# LANEBOARD_REPO_PREFIXES is the same comma-separated list the server uses.
where=""
if [ -n "$dir" ]; then
  root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || root="$dir"
  where=$(basename "$root")
  IFS=',' read -r -a laneboard_prefixes <<< "${LANEBOARD_REPO_PREFIXES:-}"
  for laneboard_p in "${laneboard_prefixes[@]}"; do
    laneboard_p=$(printf '%s' "$laneboard_p" | tr -d ' ')
    [ -n "$laneboard_p" ] && where=${where#"$laneboard_p"}
  done
fi

line="$model"
[ -n "$where" ] && line="$line · $where"
[ -n "$ctx" ] && line="$line · ctx $ctx%"
[ -n "$five" ] && line="$line · 5h $five%"
printf '%s' "$line"
