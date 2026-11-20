#!/usr/bin/env bash
# Starts the demo app on $1 and waits until it answers. A server this script
# started before is stopped first, by its PID and nothing else: the demo app
# keeps notes in memory, and a second suite run on the same server finds the
# first run's note (openspec change dogfood-replays-what-passed, design D2).
set -euo pipefail

port="$1"
# RUNNER_TEMP is empty at the start of every job. Run outside Actions, set it
# to a directory of your own, so a stale file never names someone else's PID.
pidfile="${RUNNER_TEMP:?set RUNNER_TEMP to a scratch directory}/demo-app.pid"

if [ -f "$pidfile" ]; then
  pid="$(cat "$pidfile")"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  # Still answering would let the old server, notes and all, pass the wait below.
  if kill -9 "$pid" 2>/dev/null; then
    for _ in $(seq 1 10); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
  fi
  rm -f "$pidfile"
fi

# Anything answering now is not ours, and would pass the wait below in place of
# the server about to fail on the taken port.
if curl -s -o /dev/null "http://localhost:$port/"; then
  echo "port $port is already answering; stop what is listening on it" >&2
  exit 1
fi

node examples/demo-app/serve.mjs "$port" &
server=$!
echo "$server" > "$pidfile"

for _ in $(seq 1 30); do
  if ! kill -0 "$server" 2>/dev/null; then
    echo "demo app exited before it answered (is port $port taken?)" >&2
    exit 1
  fi
  if curl -sf -o /dev/null "http://localhost:$port/"; then
    echo "demo app is up"
    exit 0
  fi
  sleep 1
done
echo "demo app did not come up in 30s" >&2
exit 1
