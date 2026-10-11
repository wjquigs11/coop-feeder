#!/usr/bin/env bash
#
# catch-feeder.sh — wait for the feeder to come online, then grab its data.
#
# The feeder spends most of its time in deep sleep and is only reachable during
# a short awake window. This script pings the host until it answers, then as
# soon as a ping succeeds it:
#   1. reads the load-cell value from the HTTP API (GET /readings)
#   2. downloads the console log (GET /console.log)
#
# Usage:
#   ./catch-feeder.sh                              # uses firmware default host
#   ./catch-feeder.sh --host 192.168.1.50 --timeout 600 --out ./capture
#
# If --host is omitted, the default is derived from the firmware's compiled-in
# default hostname in src/webserver.cpp (lowercased + ".local").
#
# Options:
#   -h, --host HOST      feeder hostname or IP (default: from src/webserver.cpp)
#   -t, --timeout SECS   give up after this many seconds (default: 0 = forever)
#   -i, --interval SECS  seconds between ping attempts (default: 1)
#   -o, --out DIR        directory to save output into (default: current dir)

set -euo pipefail

# Resolve the default host from the firmware's compiled-in default hostname:
#   src/webserver.cpp:  String host = "coopfeederBETA";
# The firmware lowercases the name for mDNS and serves it as <name>.local, so we
# do the same here. Falls back to coopfeeder.local if the source can't be read.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_host() {
  local src="${SCRIPT_DIR}/src/webserver.cpp"
  local name
  name="$(grep -oE 'String[[:space:]]+host[[:space:]]*=[[:space:]]*"[^"]+"' "$src" 2>/dev/null \
          | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  if [[ -n "$name" ]]; then
    # Lowercase to match the firmware's mDNS sanitisation, add .local.
    echo "$(echo "$name" | tr '[:upper:]' '[:lower:]').local"
  else
    echo "coopfeeder.local"
  fi
}

HOST=""
TIMEOUT=0
INTERVAL=1
OUTDIR="."

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--host)     HOST="$2"; shift 2 ;;
    -t|--timeout)  TIMEOUT="$2"; shift 2 ;;
    -i|--interval) INTERVAL="$2"; shift 2 ;;
    -o|--out)      OUTDIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# Fall back to the firmware's default hostname when --host isn't given.
if [[ -z "$HOST" ]]; then
  HOST="$(default_host)"
  echo "No --host given; using firmware default: ${HOST}"
fi

mkdir -p "$OUTDIR"

BASE_URL="http://${HOST}"
READINGS_OUT="${OUTDIR}/readings.json"
LOG_OUT="${OUTDIR}/console.log"

echo "Waiting for ${HOST} to respond to ping (interval ${INTERVAL}s, timeout ${TIMEOUT}s = 0 means forever)..."

start_epoch=$(date +%s)
attempt=0
while true; do
  attempt=$((attempt + 1))

  # One ping, 1s wait. Works on Linux/macOS (-c count, -W/-t timeout differ, so
  # keep it simple with -c 1 and let --interval pace the loop).
  if ping -c 1 "$HOST" >/dev/null 2>&1; then
    echo "Host ${HOST} is up (after ${attempt} attempt(s)). Fetching data..."
    break
  fi

  if [[ "$TIMEOUT" -gt 0 ]]; then
    elapsed=$(( $(date +%s) - start_epoch ))
    if [[ "$elapsed" -ge "$TIMEOUT" ]]; then
      echo "Timed out after ${elapsed}s waiting for ${HOST}." >&2
      exit 1
    fi
  fi

  sleep "$INTERVAL"
done

# 1. Read the load-cell value first (small, fast — grab it before the device
#    might drop back to sleep). --tries and --timeout keep wget from hanging.
echo "GET ${BASE_URL}/readings -> ${READINGS_OUT}"
if wget -q --tries=3 --timeout=10 -O "$READINGS_OUT" "${BASE_URL}/readings"; then
  echo "readings: $(cat "$READINGS_OUT")"
else
  echo "Warning: failed to fetch /readings" >&2
fi

# 2. Then download the console log.
echo "GET ${BASE_URL}/console.log -> ${LOG_OUT}"
if wget -q --tries=3 --timeout=20 -O "$LOG_OUT" "${BASE_URL}/console.log"; then
  echo "console.log saved ($(wc -l < "$LOG_OUT") lines)."
else
  echo "Warning: failed to fetch /console.log" >&2
fi

echo "Done."
