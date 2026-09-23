#!/usr/bin/env bash
# Wire ~/.claude to the laneboard: the hooks and the status line.
#
#  - settings.json is created if missing and backed up if present
#    (~/.claude/backups/settings.json.<stamp>), then merged with jq: .hooks gets
#    deploy/hooks.json, .statusLine is set only if there is none. Afterwards
#    everything except those two keys must be byte-identical, or the original
#    is restored and the script fails.
#  - the status line is installed if missing (deploy/statusline-command.sh,
#    sidecar included), else the sidecar is appended after a backup.
#
# Re-running is safe.
set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
BACKUPS="$CLAUDE_DIR/backups"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)

mkdir -p "$CLAUDE_DIR" "$BACKUPS"
if [ -f "$SETTINGS" ]; then
  cp -p "$SETTINGS" "$BACKUPS/settings.json.$STAMP"
  echo "backed up settings.json -> $BACKUPS/settings.json.$STAMP"
else
  echo '{}' > "$SETTINGS"
  echo "created $SETTINGS"
fi

tmp=$(mktemp "$CLAUDE_DIR/.settings.XXXXXX")
jq --slurpfile h "$REPO/deploy/hooks.json" '
  .hooks = ((.hooks // {}) + $h[0])
  | .statusLine = (.statusLine // {type: "command", command: "~/.claude/statusline-command.sh"})
' "$SETTINGS" > "$tmp"

if ! diff <(jq -S 'del(.hooks, .statusLine)' "$SETTINGS") <(jq -S 'del(.hooks, .statusLine)' "$tmp") >/dev/null; then
  rm -f "$tmp"
  echo "refusing: the merge changed more than .hooks and .statusLine" >&2
  exit 1
fi
mv "$tmp" "$SETTINGS"
echo "merged hooks ($(jq '.hooks | keys | length' "$SETTINGS") events) and statusLine into $SETTINGS"

cd "$REPO"
node --input-type=module -e "
  const sl = await import('./server/collector/statusline.mjs');
  console.log('statusline:', JSON.stringify(await sl.ensureStatusline()));
"
