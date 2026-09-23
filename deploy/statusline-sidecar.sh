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
