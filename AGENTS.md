# Drop

## Browser support

**The support floor** is the latest two Chrome and Firefox releases plus the current and previous Safari major (27.2 and 27.1 as of November 2026). It's the same floor as comark-ui's.

- **Use a feature directly** when [webstatus.dev](https://webstatus.dev) shows it in every browser of the floor, with no feature check or fallback.
- **When a browser of the floor lacks it** and the page still works without it, use it under `@supports`, with no fallback.
- **When the page breaks without it**, keep the JavaScript, or load a polyfill behind a feature check from bundled app code. Never inline one in the frame scripts (`shared/plan-runtime.ts`, `shared/doc-header.ts`, `shared/review-script.ts`) and never load one from a CDN.
- **Dates** need no library: format with `Intl`. Temporal waits until stable Safari ships it; then load `temporal-polyfill/global` through a dynamic import.
- **In plain-DOM code**, prefer `popover` with `popovertarget`, `<dialog>` with `showModal()`, `<details>`, and CSS anchor positioning to hand-written Escape, outside-click, focus and placement code. Vue overlays stay on Nuxt UI.

## ViteHub first

Drop runs on ViteHub. Before writing auth, migrations, storage, realtime, skills, logging, rate limits, deploy or env code, look for the ViteHub built-in in [vitehub.dev/docs](https://vitehub.dev/docs) and in the skill ViteHub ships, `node_modules/vite-hub/dist/console/runtime/public/skills/vitehub/SKILL.md`.

- **When ViteHub falls short**, fix it in [vite-hub/vitehub](https://github.com/vite-hub/vitehub) and move Drop onto the fix.
- **A workaround Drop needs meanwhile** names its issue in a comment, `// Workaround: vite-hub/vitehub#NNNN`, so the next ViteHub bump finds it.
- **Before pushing**, run `pnpm run doctor`, which includes ViteHub's rules. Plain `pnpm doctor` is pnpm's own install check.
- **Drop's MCP server is not ViteHub's.** `server/mcp/tools/**` and `server/mcp/prompts/**` use `defineMcpTool` and `defineMcpPrompt` from `nitro-mcp-toolkit`, and `server/mcp/index.ts` registers each one by hand. ViteHub's `vite-hub/mcp` docs use the same folder names, but their tools don't work here.
