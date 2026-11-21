# Drop

## Browser support

**The support floor** is the latest two Chrome and Firefox releases plus the current and previous Safari major (27.2 and 27.1 as of November 2026). It's the same floor as comark-ui's.

- **Use a feature directly** when [webstatus.dev](https://webstatus.dev) shows it in every browser of the floor, with no feature check or fallback.
- **When a browser of the floor lacks it** and the page still works without it, use it under `@supports`, with no fallback.
- **When the page breaks without it**, keep the JavaScript, or load a polyfill behind a feature check from bundled app code. Never inline one in the frame scripts (`shared/plan-runtime.ts`, `shared/doc-header.ts`, `shared/review-script.ts`) and never load one from a CDN.
- **Dates** need no library: format with `Intl`. Temporal waits until stable Safari ships it; then load `temporal-polyfill/global` through a dynamic import.
- **In plain-DOM code**, prefer `popover` with `popovertarget`, `<dialog>` with `showModal()`, `<details>`, and CSS anchor positioning to hand-written Escape, outside-click, focus and placement code. Vue overlays stay on Nuxt UI.
