#!/usr/bin/env bash
# Soak the laneboard and record RSS, CPU and hook latency.
#   deploy/soak.sh [minutes] [outfile]
# Samples every 30 s; CPU is measured from /proc/<pid>/stat deltas, not `ps`,
# so it is the real average over the interval rather than since boot.
set -uo pipefail

MINUTES="${1:-30}"
OUT="${2:-data/soak-$(date +%Y%m%d-%H%M%S).tsv}"
BASE="${LANEBOARD_URL:-http://127.0.0.1:7777}"
INTERVAL=30

pid() { curl -sf -m 2 "$BASE/healthz" 2>/dev/null | sed -n 's/.*"pid":\([0-9]*\).*/\1/p'; }

P="$(pid)"
[ -n "$P" ] || { echo "laneboard is not responding at $BASE"; exit 1; }

mkdir -p "$(dirname "$OUT")"
printf 'ts\telapsed_s\trss_mb\tcpu_pct\thook_ms\tsessions\theap_mb\tterminals\n' > "$OUT"

ticks() { awk '{print $14+$15}' "/proc/$1/stat" 2>/dev/null; }

START=$(date +%s)
END=$((START + MINUTES * 60))
PREV_T="$(ticks "$P")"
PREV_S=$(date +%s)

while [ "$(date +%s)" -lt "$END" ]; do
  sleep "$INTERVAL"
  NOW=$(date +%s)

  NEWP="$(pid)"
  if [ "$NEWP" != "$P" ]; then
    # A restart resets the counters; note it and re-baseline rather than lie.
    printf '%s\t%s\tRESTART\told=%s\tnew=%s\t\t\t\n' "$(date -Is)" "$((NOW-START))" "$P" "$NEWP" >> "$OUT"
    P="$NEWP"; PREV_T="$(ticks "$P")"; PREV_S="$NOW"; continue
  fi

  RSS=$(( $(awk '/VmRSS/{print $2}' "/proc/$P/status" 2>/dev/null || echo 0) / 1024 ))
  T="$(ticks "$P")"
  DT=$((NOW - PREV_S))
  CPU=$(awk -v a="$PREV_T" -v b="$T" -v d="$DT" 'BEGIN{ if (d>0) printf "%.2f", (b-a)/100/d*100; else print "0" }')
  PREV_T="$T"; PREV_S="$NOW"

  # Hook latency: the number that must stay tiny, because every session waits on it.
  HOOK=$(curl -s -o /dev/null -w '%{time_total}' -m 2 -X POST \
    -H 'content-type: application/json' \
    -d '{"session_id":"soak","hook_event_name":"PostToolUse","tool_name":"Soak"}' \
    "$BASE/api/hook" 2>/dev/null | awk '{printf "%.2f", $1*1000}')

  STATE=$(curl -sf -m 3 "$BASE/api/state" 2>/dev/null)
  SESSIONS=$(printf '%s' "$STATE" | grep -o '"name":' | wc -l)
  HEALTH=$(curl -sf -m 2 "$BASE/healthz" 2>/dev/null)
  HEAP=$(printf '%s' "$HEALTH" | sed -n 's/.*"heapUsedMb":\([0-9]*\).*/\1/p')
  TERMS=$(printf '%s' "$HEALTH" | sed -n 's/.*"terminals":\([0-9]*\).*/\1/p')

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -Is)" "$((NOW-START))" "$RSS" "$CPU" "$HOOK" "$SESSIONS" "${HEAP:-}" "${TERMS:-}" >> "$OUT"
done

echo "soak finished -> $OUT"
awk -F'\t' 'NR>1 && $3 ~ /^[0-9]/ {
  n++; rss+=$3; cpu+=$4; hook+=$5;
  if ($3>maxrss) maxrss=$3; if ($4+0>maxcpu) maxcpu=$4+0; if ($5+0>maxhook) maxhook=$5+0
} END {
  if (n) printf "samples %d\nrss  avg %.0f MB  max %.0f MB\ncpu  avg %.2f %%  max %.2f %%\nhook avg %.2f ms  max %.2f ms\n",
    n, rss/n, maxrss, cpu/n, maxcpu, hook/n, maxhook
}' "$OUT"
