#!/usr/bin/env bash
# Starts the demo app on $1 and waits until it answers. A server this script
# started before is stopped first, by its PID and nothing else: the demo app
# keeps notes in memory, and a second suite run on the same server finds the
# first run's note (openspec change dogfood-replays-what-passed, design D2).
set -euo pipefail

port="$1"
pidfile="${RUNNER_TEMP:-/tmp}/demo-app.pid"

if [ -f "$pidfile" ]; then
  pid="$(cat "$pidfile")"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  rm -f "$pidfile"
fi

node examples/demo-app/serve.mjs "$port" &
echo $! > "$pidfile"

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://localhost:$port/"; then
    echo "demo app is up"
    exit 0
  fi
  sleep 1
done
echo "demo app did not come up in 30s" >&2
exit 1
