#!/bin/sh
# Row 6, Firefox: the extension opens a WebSocket in runtime.onInstalled, then nothing happens for 330 s.
# The add-on is preinstalled into a fresh profile as an unsigned XPI (ESR honours
# xpinstall.signatures.required=false), so Firefox runs with no Marionette, BiDi or RDP client attached.
# Needs harness/server.mjs running. Usage: harness/idle-ws-firefox.sh <firefox binary>
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
firefox=$1
profile=$(mktemp -d /tmp/drop-spike-idle-firefox-XXXX)
mkdir -p "$profile/extensions"
(cd "$here/.output/firefox-mv3" && zip -qr "$profile/extensions/drop-spike@example.com.xpi" .)
cat > "$profile/user.js" <<'EOF'
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("browser.aboutwelcome.enabled", false);
EOF
echo "$(date -u +%FT%TZ) start firefox idle run" | tee -a "$here/results/ws-server.log"
"$firefox" -headless -no-remote -profile "$profile" about:blank > "$here/results/idle-firefox-browser.log" 2>&1 &
pid=$!
echo "$pid" > "$here/results/idle-firefox.pid"
sleep "${SPIKE_IDLE_SECONDS:-330}"
echo "$(date -u +%FT%TZ) stop firefox idle run" | tee -a "$here/results/ws-server.log"
kill "$pid"
wait "$pid" || true
rm -rf "$profile"
