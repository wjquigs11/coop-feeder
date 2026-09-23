#!/bin/zsh
# Streams filtered logcat for the CoopFeeder app to a log file.
# Re-attaches across app restarts / Metro reloads by tracking the live PID
# and killing any stale adb logcat that is still following a dead PID.
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
SERIAL="${ANDROID_SERIAL:-RFCR91266HT}"
PKG="com.wjquigs.coopfeeder"
LOGFILE="${1:-/tmp/coopfeeder-logcat.log}"
: > "$LOGFILE"

CUR_PID=""
CHILD=""
while true; do
  PID=$(adb -s "$SERIAL" shell pidof "$PKG" | tr -d '\r')
  if [ -n "$PID" ] && [ "$PID" != "$CUR_PID" ]; then
    # PID changed (app started or relaunched) -> restart the logcat follow
    [ -n "$CHILD" ] && kill "$CHILD" 2>/dev/null
    echo "=== $(date '+%H:%M:%S') attaching logcat to PID $PID ===" >> "$LOGFILE"
    adb -s "$SERIAL" logcat -v time --pid "$PID" >> "$LOGFILE" 2>&1 &
    CHILD=$!
    CUR_PID="$PID"
  fi
  sleep 2
done
