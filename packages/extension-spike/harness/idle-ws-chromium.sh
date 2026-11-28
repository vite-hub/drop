#!/bin/sh
# Row 6, Chromium: the extension opens a WebSocket in runtime.onInstalled, then nothing happens for 330 s.
# Chromium runs without any DevTools connection, since an attached debugger keeps a service worker alive.
# --no-sandbox because this machine blocks unprivileged user namespaces (Playwright passes it too).
# Needs harness/server.mjs running. The ws server's log says when the socket closed.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
chrome=${CHROME:-$(node -e "console.log(require('playwright').chromium.executablePath())")}
profile=$(mktemp -d /tmp/drop-spike-idle-chromium-XXXX)
echo "$(date -u +%FT%TZ) start chromium idle run" | tee -a "$here/results/ws-server.log"
"$chrome" --headless=new --user-data-dir="$profile" \
  --no-sandbox --disable-extensions-except="$here/.output/chrome-mv3" --load-extension="$here/.output/chrome-mv3" \
  about:blank > "$here/results/idle-chromium-browser.log" 2>&1 &
pid=$!
echo "$pid" > "$here/results/idle-chromium.pid"
sleep "${SPIKE_IDLE_SECONDS:-330}"
echo "$(date -u +%FT%TZ) stop chromium idle run" | tee -a "$here/results/ws-server.log"
kill "$pid"
wait "$pid" || true
rm -rf "$profile"
