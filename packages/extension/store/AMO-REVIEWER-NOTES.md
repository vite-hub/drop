# Notes for AMO reviewers

Drop's extension is built with [WXT](https://wxt.dev) 0.21.5, Vue 3.5 and Nuxt UI 4.13 from the source in
`packages/extension` of https://github.com/vite-hub/drop. To rebuild the submitted package:

```sh
pnpm install --frozen-lockfile
pnpm --filter @vite-hub/drop-extension build:firefox   # writes .output/firefox-mv3
```

The build bundles everything it runs: no remote code, no CDN fonts (Geist ships as woff2 files), and no icon API
(the MingCute icons the pages use are compiled into the bundle, and `@iconify/vue` is aliased to its offline build).

## `web-ext lint` warnings

`web-ext lint --source-dir .output/firefox-mv3` reports 0 errors and 10 warnings.

**`UNSAFE_VAR_ASSIGNMENT` in `content-scripts/review.js` (3).** The review pill's shadow root, its resolve button and
its link icons are filled from string constants built into the script: the pill's own CSS, markup and SVG icons. Text
from the page or from Drop (comments, names, titles, links) is set with `textContent` or `setAttribute` only.

**`UNSAFE_VAR_ASSIGNMENT` in `chunks/ConnectProblem-*.js` (5).** That chunk is the shared vendor chunk of the
extension's own pages (popup, options, welcome). The five assignments are library code:

| Library | Assignment | What it is given |
| --- | --- | --- |
| Vue `runtime-dom` | `insertStaticContent`: `template.innerHTML = …` | Static markup compiled from the extension's own `.vue` templates at build time |
| `@iconify/vue` (offline) | `svg.innerHTML = body` | The SVG body of an icon bundled in the extension |
| `@unhead/vue` (3) | `innerHTML` on `<script>`/`<style>`/`<noscript>` head tags | Head tags the pages declare; the extension declares none |

None of them receives data from a website, a message or the network. Text from the user's Drop (names, site
origins) is rendered through Vue text interpolation only; the source has no `v-html`.

**`KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION` and `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` (2).**
`browser_specific_settings.gecko.data_collection_permissions` arrived in Firefox 140 (Android 142). The extension
supports Firefox 128 ESR, so `strict_min_version` stays at 128.0; older versions ignore the key.

## Permissions

- **activeTab, scripting:** the review host goes into a tab only after a press (toolbar button, `Alt+Shift+D`, or the
  "Comment with Drop" menu item), in the top frame only.
- **Host access is optional.** The manifest asks for none. `<all_urls>` is requested only when the user turns on
  "On every page"; a single site's pattern only when they keep Drop on that site; the user's Drop address only when
  they connect it.
- **identity:** `launchWebAuthFlow` signs in to the user's own Drop (OAuth 2.1 code flow with PKCE).
- **storage:** the Drop address, the sign-in tokens (read only by the background), and the user's settings.
- **contextMenus:** the "Comment with Drop" item.

## Data collection

`wxt.config.ts` declares `data_collection_permissions: { required: ["browsingActivity", "websiteContent"] }`. What
leaves the browser goes only to the Drop the person connects: the origin of each site they press Drop on
(browsingActivity), and what they review there: comments, element references and screenshots (websiteContent).

The privacy policy is [PRIVACY.md](PRIVACY.md), published at https://drop.vitehub.dev/docs/extension#privacy.
[PRIVACY-CLAIMS.md](PRIVACY-CLAIMS.md) names the test behind each of its claims.

<!-- TODO(Maxi): approve this wording and these two types before submitting. -->
