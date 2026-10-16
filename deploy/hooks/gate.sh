#!/bin/sh
# laneboard pause gate: a synchronous Claude Code hook (PreToolUse, UserPromptSubmit).
#
# The installer copies this file to ~/.claude/laneboard/gate.sh. It blocks the
# session while a pause sentinel written by laneboard (server/control/pause.mjs)
# or by `laneboard pause` matches it, or while the session's statusline cost has
# reached the budget ceiling the server wrote:
#
#   $S/paused/ALL            builder-wide pause
#   $S/paused/<sessionName>  one tmux session (name looked up via $TMUX_PANE)
#   $S/paused/sid-<id>       mirror of a session pause, keyed by Claude session id
#   $S/ceiling/sid-<id>      JSON number: the statusline cost.total_cost_usd at
#                            which this session must stop
#
# with S = $LANEBOARD_STATE_DIR or ~/.local/state/laneboard.
#
# Failure policy:
#  - fast path (neither paused/ nor ceiling/ exists): exit 0, no output, no
#    reads; a broken or absent laneboard is invisible;
#  - nothing matched: exit 0, no output (fail open);
#  - a sentinel matched but the hook event cannot be parsed (jq missing or
#    broken, malformed stdin, unknown event): reason on stderr, exit 2, which
#    blocks PreToolUse and UserPromptSubmit (fail closed while paused);
#  - the tmux session-name lookup (SR21 L1) runs only when ALL and the sid
#    mirror did not match AND a by-name pause exists, under `timeout 2` where
#    available. If it times out the decision depends on an answer we cannot
#    get, so the gate denies (fail closed) with its own reason; a tmux that
#    answers with an error (no server, pane gone) is "no name", as before.
#    Without a `timeout` binary the lookup runs unbounded and Claude Code's 5 s
#    hook timeout applies (fail open: documented, cooperative control).
#
# This is a cooperative control: an agent with a shell on this machine can
# delete the sentinels or edit this file. POSIX sh + jq only.

S="${LANEBOARD_STATE_DIR:-$HOME/.local/state/laneboard}"
[ -d "$S/paused" ] || [ -d "$S/ceiling" ] || exit 0

in=$(cat 2>/dev/null)
ev=$(printf '%s' "$in" | jq -r '.hook_event_name // empty | strings' 2>/dev/null)
sid=$(printf '%s' "$in" | jq -r '.session_id // empty | strings' 2>/dev/null)

# The session id comes from untrusted stdin and becomes part of a path: accept
# only a plain id (Claude uses UUIDs).
case "$sid" in
  *[!A-Za-z0-9_-]*) sid="" ;;
esac
[ "${#sid}" -le 128 ] || sid=""

hit=""
for f in "$S/paused/ALL" ${sid:+"$S/paused/sid-$sid"}; do
  if [ -e "$f" ]; then hit=$f; break; fi
done

# By-name pauses: is there any sentinel that is not ALL or a sid- mirror?
# (atomic-write temp files start with a dot and are not matched by *)
names=""
if [ -z "$hit" ] && [ -n "$TMUX_PANE" ] && [ -d "$S/paused" ]; then
  for f in "$S/paused"/*; do
    [ -e "$f" ] || continue
    case "${f##*/}" in
      ALL | sid-*) ;;
      *) names=1; break ;;
    esac
  done
fi

name=""
tmux_timeout=""
if [ -n "$names" ]; then
  if command -v timeout >/dev/null 2>&1; then
    name=$(timeout -k 1 2 tmux display-message -p -t "$TMUX_PANE" '#S' 2>/dev/null)
    rc=$?
    case "$rc" in 124 | 137) tmux_timeout=1; name="" ;; esac
  else
    name=$(tmux display-message -p -t "$TMUX_PANE" '#S' 2>/dev/null)
  fi
  case "$name" in
    */* | . | .. | .* | ALL | sid-*) name="" ;;
  esac
  if [ -n "$name" ] && [ -e "$S/paused/$name" ]; then hit="$S/paused/$name"; fi
  if [ -z "$hit" ] && [ -n "$tmux_timeout" ]; then hit="tmux-timeout"; fi
fi

kind=""
if [ "$hit" = "tmux-timeout" ]; then
  kind="tmux-timeout"
elif [ -n "$hit" ]; then
  kind=$(jq -r '.kind // empty | strings' "$hit" 2>/dev/null)
elif [ -n "$sid" ] && [ -e "$S/ceiling/sid-$sid" ]; then
  # Budget ceiling: stop once the statusline total reaches the ceiling. When
  # either number is unreadable this check does not fire; the server-side
  # budget pause still applies.
  st="$HOME/.cache/laneboard/status/$sid.json"
  if [ -e "$st" ]; then
    over=$(jq -rn --slurpfile c "$S/ceiling/sid-$sid" --slurpfile s "$st" '
      ($c[0] | if type == "number" then . elif type == "object" then (.usd // null) else null end) as $lim
      | ($s[0].cost.total_cost_usd // null) as $usd
      | if ($lim | type) == "number" and ($usd | type) == "number" and $usd >= $lim then "over" else empty end
    ' 2>/dev/null)
    if [ "$over" = "over" ]; then hit="$S/ceiling/sid-$sid"; kind="ceiling"; fi
  fi
fi

[ -z "$hit" ] && exit 0

case "$kind" in
  budget | ceiling) reason="Stopped by laneboard: this lane reached its budget. Do not retry or work around this; stop and wait for the operator." ;;
  tmux-timeout) reason="Blocked by laneboard: a session pause is set and tmux did not answer within 2 s, so this session could not be checked. Denied to be safe; retry shortly or ask the operator." ;;
  quota) reason="Paused by laneboard: the usage quota guard paused low-priority lanes. Do not retry or work around this; stop and wait to be resumed." ;;
  *) reason="Paused by operator via laneboard. Do not retry or work around this; stop and wait to be resumed." ;;
esac

# The reasons are constants without quotes or backslashes, so plain printf
# produces valid JSON and the output does not depend on jq.
case "$ev" in
  PreToolUse)
    printf '{"continue":false,"stopReason":"%s","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason" "$reason"
    ;;
  UserPromptSubmit)
    printf '{"decision":"block","reason":"%s"}\n' "$reason"
    ;;
  *)
    printf '%s\n' "$reason" >&2
    exit 2
    ;;
esac
exit 0
