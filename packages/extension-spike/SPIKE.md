# Drop extension platform spike

A throwaway spike. It checks whether the extension stack and the browser APIs that Drop's extension needs work in Chrome MV3 and Firefox 128 ESR. Every row below comes from a run on 2026-11-28. The raw output is in `results/`.

- **Browsers:** Playwright's Chromium 159.0.8154.6, and Firefox 128.14.0esr from ftp.mozilla.org.
- **Stack:** WXT 0.21.5, @wxt-dev/module-vue 1.0.3, Vue 3.5.46, and Nuxt UI 4.13.1 through `@nuxt/ui/vite`.
- **Manifest:** permissions `activeTab scripting storage identity contextMenus`, no required host permissions, and `optional_host_permissions: ["<all_urls>"]` at the top level. Firefox 128 accepts it there and grants from it (row 1). The manifest also has the command `Alt+Shift+Y`, plus `gecko.id` and `strict_min_version: "128.0"`.

## Results

"Headless" means Chromium `--headless=new` (Playwright `channel: "chromium"`) or Firefox `-headless`. "Headed" means a real window under Xvfb `:97`, with real key presses sent through XTEST (`harness/xkey.py`). Each row ran at DPR 1 and DPR 2.

| # | Check | Chromium 159 | Firefox 128.14 ESR |
|---|---|---|---|
| 1 | `permissions.request({origins:["https://example.test/*"]})` from a click, then `contains` | **Pass, headed only.** XTEST "Tab Return" accepts the dialog and returns `{granted:true, contains:true}`. In headless the prompt never resolves (15 s timeout). | **Pass, headless and headed.** The doorhanger `#addon-webext-permissions-notification` is accepted from the chrome context and returns `{granted:true, contains:true}`. |
| 2a | `executeScript` with no user action | Fails as expected: "Cannot access contents of the page…" | Fails as expected: "Missing host permission for the tab" |
| 2b | Trigger that grants activeTab | **Pass.** The action popup opened by CDP `Extensions.triggerAction` works, headless too. So does the command `Alt+Shift+Y` as a real X key press (headed). Playwright's `keyboard.press` does **not** fire the command. | **Pass.** The toolbar button (inner `.unified-extensions-item-action-button`, clicked from the chrome context) opens the popup. The command `Alt+Shift+Y` fires from chrome-context key actions (headless) and from a real X key (headed). |
| 2c | activeTab after a same-origin link navigation | **Kept.** Re-inject on `/page2` works. | **Revoked.** Same page OK, then "Missing host permission" after the click to `/page2`. |
| 2d | activeTab after a cross-origin navigation | Revoked | Revoked |
| 2e | Automatic injection from `tabs.onUpdated` after granting one origin | **Pass, headed only** (the grant needs the dialog). Grant `http://127.0.0.1:47810/*`, then reload: `tab.url` is visible and `inject via onUpdated` succeeds. | **Pass with a port-less pattern.** Grant `http://127.0.0.1/*`: `tab.url` is visible and inject succeeds. With `http://127.0.0.1:47810/*` the grant and `contains` both say true, but `tab.url` is `null` and executeScript fails with "Missing host permission" (`results/firefox-dpr1-port-pattern.json`). |
| 3 | `captureVisibleTab` size equals viewport × DPR | **Pass.** DPR 1: 800×513 → 800×513. DPR 2: 800×513 → 1600×1026. Same in headless and headed. | **Pass.** DPR 1: 800×417 → 800×417. DPR 2: 800×418 → 1600×836. Headed: 800×419 and 800×420 → ×2. |
| 4 | Closed shadow root on a `default-src 'none'` page: `<style>` and `adoptedStyleSheets` | **Pass.** `shadowRoot` is null from the page. `<style>` gives red with 7px padding. The adopted sheet gives blue. | **`<style>` passes.** The adopted sheet **fails**: `Error: Accessing from Xray wrapper is not supported.` It works when the sheet and the array are built in the page realm: `new window.wrappedJSObject.CSSStyleSheet()`, set on `root.wrappedJSObject.adoptedStyleSheets` (blue). |
| 5 | `launchWebAuthFlow` to a local `/auth` that 302s to `getRedirectURL()?code=<sid cookie>` | **Pass.** It redirects to `https://<id>.chromiumapp.org/?code=<sid>`, the cookie set in a normal tab is sent, and no window shows. | **Pass.** It redirects to `https://<hash>.extensions.allizom.org/?code=<sid>` and the cookie is sent. |
| 6 | Background WebSocket left idle for 5.5 min with no client attached | **Fails idle:** closed with code 1001 after **30.3 s**, when the service worker stopped. **With a server message every 20 s:** still open after **328.9 s**, when the browser was killed. | **Fails idle:** closed with code 1001 after **30.0 s**, when the event page was suspended. **With a server message every 20 s it still fails:** closed after **30.8 s**. Incoming messages don't keep the Firefox event page alive. |
| 7 | MingCute icon offline, and the bundle has no `api.iconify.design` | **Pass.** With the network offline: `svg#icon` has 1 path at 24 px, the button icon has 1 path, and only `chrome-extension://` requests are made. | **Pass.** With `Services.io.offline` on: icon 1 path, button icon 1 path, `navigator.onLine === false`. |
| 7b | `grep -rl api.iconify.design .output` | No match (exit 1) after the fix. Before it, `chunks/browser-*.js` contained the URL. | Same build |
| 8 | Harness that loads the extension in Firefox 128 | n/a | **geckodriver + Marionette works.** puppeteer BiDi **fails** to install. `web-ext run` + BiDi installs but **can't** open extension pages. A sideloaded unsigned XPI **works**. Details below. |

Row 6 note: Chromium's 30 s runs had no DevTools attached (`harness/idle-ws-*.sh`). Playwright attaches to service workers, and that keeps them alive.

### Row 8: Firefox 128 harnesses

| Harness | Result | Command |
|---|---|---|
| puppeteer-core 25.19 (WebDriver BiDi), `browser.installExtension` | **Fail.** Launch works, but install says `unknown command webExtension.install`. The same probe on Firefox 161 installs (`results/probe-puppeteer-ff161.log`). | `node harness/probe-puppeteer-firefox.mjs .browsers/ff128/firefox/firefox` |
| `web-ext run` with `--remote-debugging-port` + `puppeteer.connect({protocol:"webDriverBiDi"})` | **Partial.** It installs as a temporary add-on and connects (`firefox/128.14.0`). Navigating to `moz-extension://…` fails with `NS_ERROR_NOT_AVAILABLE`, a `moz-extension` start URL doesn't open, and BiDi can't reach the toolbar or doorhanger. | `node harness/probe-webext-run-firefox.mjs .browsers/ff128/firefox/firefox 47812`, which runs `web-ext run --firefox <bin> --source-dir .output/firefox-mv3 --no-reload --no-input --pref extensions.webextensions.uuids=… --arg=-headless --arg=--remote-debugging-port=47812` |
| selenium-webdriver 4.54 + geckodriver 0.37.1 (Marionette) | **Pass, and every row runs headless.** Install by `path` with `temporary:true`. `driver.installAddon()` sends base64 `addon`, which 128's Marionette rejects with InvalidArgumentError. The chrome context reaches the toolbar button, the doorhanger and the key shortcuts. | `SPIKE_DPR=1 node harness/firefox.mjs .browsers/ff128/firefox/firefox` |
| Unsigned XPI sideloaded into a fresh profile (`extensions/<id>.xpi`, `xpinstall.signatures.required=false`) | **Pass on ESR.** `onInstalled` fires and the socket opens with no automation attached. Used for row 6. | `harness/idle-ws-firefox.sh .browsers/ff128/firefox/firefox` |

## Build, lint and Nuxt UI

- **`wxt build`:** 486.75 kB total for Chrome and 486.87 kB for Firefox. Both are mostly the CSS at 214.96 kB and the shared `chunks/browser-*.js` at 230.44 kB (Vue, Nuxt UI, Reka, the icons). `Toast` adds 29.15 kB and the overlay content script 4.53 kB. See `results/build-*.log`.
- **`wxt build -b firefox`** builds MV2 unless `manifestVersion: 3` is set. Its manifest gets `background.scripts` (an event page) where Chrome gets a service worker. WXT warns that `data_collection_permissions` is missing.
- **`web-ext lint`:** 0 errors, 0 notices, 6 warnings.
  - 1 warning is `MISSING_DATA_COLLECTION_PERMISSIONS`.
  - 5 are `UNSAFE_VAR_ASSIGNMENT` (innerHTML), all in `chunks/browser-*.js`. They come from Vue's static-content insert, Iconify's SVG render and unhead's tag render.
  - Output is in `results/web-ext-lint.json`.
- **What `@nuxt/ui/vite` needs under WXT:**
  - Add it as `vite: () => ({ plugins: [ui({...})] })`. It already bundles `@tailwindcss/vite`, unplugin-auto-import and unplugin-vue-components, so adding any of them again throws a duplicate-plugin error.
  - The app config (`colors`) goes in `ui({ ui: {...} })`. The CSS is `@import "tailwindcss"; @import "@nuxt/ui";`, and the Vue plugin is `@nuxt/ui/vue-plugin`.
  - It writes `auto-imports.d.ts` and `components.d.ts` into the package root, so gitignore them.
  - **Offline icons need two settings.**
    - `icon: { clientBundle: { scan: true } }` bundles the MingCute data.
    - Alias `@iconify/vue` to `assets/iconify-offline.ts`, a shim over `@iconify/vue/offline`. Without it, `UIcon` imports the online `@iconify/vue`, which ships `api.iconify.design`. The shim's `addIcon` registers both the `mingcute:x` and `mingcute-x` names, because the offline `Icon` looks names up verbatim.

## Surprises

1. **Firefox 128 ESR updated itself to 153.8.0esr during the run.** An unpinned tarball install with a plain profile downloaded the update and applied it on the next start. Pin the version with `distribution/policies.json` set to `{"policies":{"DisableAppUpdate":true}}`. On 153, geckodriver also needs `--allow-system-access`, or Marionette refuses the chrome context and `moz-extension://` navigation. The harness passes the flag, and 128 ignores it.
2. **Firefox's default MV3 CSP adds `upgrade-insecure-requests`.** A background `ws://127.0.0.1` socket becomes `wss://` and closes with code 1015. The spike sets `content_security_policy.extension_pages: "script-src 'self'"`. Production should use `wss://`.
3. **Firefox drops activeTab on any navigation, even same-origin.** Chromium keeps it within the origin.
4. **Firefox match patterns with a port grant but don't work.** Ask for `https://host/*`, not `https://host:port/*`.
5. **`adoptedStyleSheets` from a Firefox 128 content script throws** (Xray wrapper). Use `<style>` in the shadow root, or the page-realm workaround in row 4.
6. **A background socket can't stay up in Firefox,** even with server traffic: 30 s idle and it closes. In Chromium, a message under every 30 s keeps the worker alive.
7. **Chromium's permission dialog can't be answered in headless.** Playwright key presses reach neither the dialog nor extension commands, but XTEST keys under Xvfb reach both.
8. **The Firefox toolbar widget's id sits on a wrapper.** Clicking `#<id>-browser-action` does nothing; the popup opens from its `.unified-extensions-item-action-button`. The doorhanger's primary button can't be scrolled into view by WebDriver, so it is clicked from script.
9. Adding the spike's dev dependencies changed peer-set hashes for some root importers in `pnpm-lock.yaml` (same versions). pnpm also added `ws@8.23.1` to `minimumReleaseAgeExclude`.

## Recommended e2e setup

**Chromium.**
- Use Playwright `launchPersistentContext` with `channel: "chromium"`, headless `new`, `--disable-extensions-except`/`--load-extension`, and `--enable-unsafe-extension-debugging`.
- Drive the action and its activeTab paths with CDP `Extensions.triggerAction`. It needs a `tab`-type target from `Target.getTargets({filter:[{type:"tab"}]})` and the pipe connection Playwright already uses.
- Permission dialogs and real command shortcuts need a headed run under Xvfb with XTEST keys (`harness/xkey.py`).
- Lifetime tests spawn Chromium with no CDP client (`harness/idle-ws-chromium.sh`).

**Firefox 128 ESR.**
- Use selenium-webdriver with geckodriver (Selenium Manager downloads 0.37.1) and `ServiceBuilder().addArguments("--allow-system-access")`.
- Install with the raw `install addon` command, `path` and `temporary: true`.
- Fix the extension UUID with `extensions.webextensions.uuids`.
- Use Marionette's chrome context for the toolbar button, the permission doorhanger and the shortcut keys. Everything runs headless.
- Run against a pinned ESR tarball with updates disabled by policy.
- Lifetime tests sideload the unsigned XPI into a profile.
- Skip puppeteer on 128.

## Not run

- **Context-menu trigger:** the menu item is registered, but no harness clicks a native context menu.
- **Firefox on macOS or Windows, and branded Chrome:** Linux only, Playwright's Chromium build.
- **Signed Firefox install:** the XPIs are unsigned and installed as temporary add-ons, or sideloaded on ESR with signatures off.

## Reproduce

Run all of this from `packages/extension-spike`, after `pnpm install` at the repository root.

```sh
# Firefox 128 ESR, pinned
mkdir -p .browsers/dl .browsers/ff128
curl -L -o .browsers/dl/firefox-128.14.0esr.tar.bz2 \
  https://ftp.mozilla.org/pub/firefox/releases/128.14.0esr/linux-x86_64/en-US/firefox-128.14.0esr.tar.bz2
tar -xjf .browsers/dl/firefox-128.14.0esr.tar.bz2 -C .browsers/ff128
mkdir -p .browsers/ff128/firefox/distribution
echo '{"policies":{"DisableAppUpdate":true}}' > .browsers/ff128/firefox/distribution/policies.json
pnpm exec playwright install chromium

# Builds, lint, icon grep
heavy pnpm run build && heavy pnpm run build:firefox
heavy --light pnpm exec web-ext lint --source-dir .output/firefox-mv3 --output json
grep -rl api.iconify.design .output   # expect no output, exit 1

# Test server: HTTP on 47810, WS on 47811. SPIKE_WS_PUSH_SECONDS=20 makes the server send every 20 s.
node harness/server.mjs &              # pid in results/server.pid
Xvfb :97 -screen 0 1280x900x24 -nolisten tcp &   # headed runs only

# Rows 1–5 and 7
SPIKE_DPR=1 node harness/chromium.mjs
DISPLAY=:97 SPIKE_HEADED=1 SPIKE_DPR=2 node harness/chromium.mjs
SPIKE_DPR=1 node harness/firefox.mjs .browsers/ff128/firefox/firefox
DISPLAY=:97 SPIKE_HEADED=1 SPIKE_DPR=2 node harness/firefox.mjs .browsers/ff128/firefox/firefox
SPIKE_GRANT_PATTERN='http://127.0.0.1:47810/*' node harness/firefox.mjs .browsers/ff128/firefox/firefox

# Row 6 (5.5 min each; read results/ws-server.log)
harness/idle-ws-chromium.sh
harness/idle-ws-firefox.sh .browsers/ff128/firefox/firefox

# Row 8 probes
node harness/probe-puppeteer-firefox.mjs .browsers/ff128/firefox/firefox
node harness/probe-webext-run-firefox.mjs .browsers/ff128/firefox/firefox 47812
```

Each harness writes `results/<browser>-dpr<N>[-headed].json` with every step's `{ok, ms, value|error}`. A step can be `ok` while its value holds the browser's error, as in 2a. `results/ws-server.log` lists the row 6 sockets.
- **Chromium:** `ws#13` with no push, and `ws#1` with push (numbering restarts with the server).
- **Firefox 128:** `ws#32` with no push, and `ws#3` with push.
- Entries between 11:38 and 12:03 UTC come from the Firefox that had updated itself to 153, so ignore them.
