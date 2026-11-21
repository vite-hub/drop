import { escapeUTF8 as escapeHtml } from "entities"
import type { PlanKind } from "./plans"
import { DOC_HEADER_SCRIPT } from "./doc-header"
import { injectRuntime, THEME_CSS } from "./plan-runtime"
import { TYPESET_CSS } from "./typeset"

export const DOC_WIDTHS = { readable: "46rem", wide: "64rem", full: "80rem" } as const
export type DocWidth = keyof typeof DOC_WIDTHS

const DOCUMENT_EXTRA_CSS = `
/* The text moves left only as far as it must to clear the viewer's floating panel (--drop-inset). Once the column
   can't fit beside it, the column narrows: the panel never covers the text. comark-outline's side outline keeps clear
   of the panel too (--comark-inset-end), and when it needs a column of its own beside wide blocks it sets
   data-comark-rail, which gives --comark-rail-width; a wide block keeps clear of both (document-shell.css). */
:root { --comark-inset-end: var(--drop-inset, 0px); }
html:root.drop-zen { --comark-rail-width: 0px; }
:root.drop-zen .cto-rail { display: none !important; }
body { margin: 0; background: var(--background); color: var(--foreground); transition: padding-right .2s ease-out;
  --drop-right: var(--drop-inset, 0px);
  --drop-shift: clamp(0px, calc(2 * var(--drop-inset, 0px) + var(--drop-column, 46rem) + var(--drop-rail, 0px) - 100vw), max(0px, calc(var(--drop-inset, 0px) - 1.5rem)));
  padding-right: var(--drop-shift); }
/* The app's grain (shared/theme.css) on the doc too, so the frame doesn't read as a flat sheet inside the page. The
   root carries it where a short doc's body ends. */
html, body { background-image: var(--surface-grain); background-size: var(--surface-grain-size); }
main { width: min(100% - 2rem, var(--drop-column, 46rem) + var(--drop-rail, 0px)); margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
@media (max-width: 36rem) { main { width: min(100% - 1.25rem, var(--drop-column, 46rem)); } }
.typeset :is(h2, h3) { scroll-margin-top: 1.5rem; }
/* \`::drop\` (EMBEDS_SCRIPT): another drop's box, a link until the viewer fills it with the drop in a frame. */
.drop-embed { display: grid; place-items: center; height: var(--drop-embed-height, 480px); margin: 1.5rem 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--muted); overflow: hidden; }
.drop-embed iframe { display: block; width: 100%; height: 100%; border: 0; background: var(--background); }
.drop-embed-note { margin: 0; padding: 1rem; color: var(--muted-foreground); font-size: .875rem; text-align: center; }
/* An image on its way (DEFERRED_FILES_SCRIPT) keeps a screenshot's room, so the text below doesn't jump as much. */
.typeset img[data-drop-image] { width: 100%; aspect-ratio: 16 / 10; background: var(--muted); }
`

const DEFERRED_FILES_SCRIPT = String.raw`(() => {
  const waiting = document.querySelectorAll("img[data-drop-image], [data-drop-media]");
  if (!waiting.length) return;
  const asked = new Set();
  // The document as root: a sandboxed frame is cross-origin, and browsers ignore rootMargin on its implicit root.
  const near = new IntersectionObserver((entries) => {
    const paths = [];
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      near.unobserve(entry.target);
      const path = entry.target.dataset.dropImage || entry.target.dataset.dropMedia;
      if (path && !asked.has(path)) { asked.add(path); paths.push(path); }
    }
    if (paths.length) parent.postMessage({ __drop: true, type: "files", paths }, "*");
  }, { root: document, rootMargin: "150% 0px" });
  waiting.forEach((element) => near.observe(element));
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent || m.type !== "file-data") return;
    if (m.data instanceof Blob) {
      let url;
      for (const media of document.querySelectorAll("[data-drop-media]")) {
        if (media.dataset.dropMedia !== m.path) continue;
        media.src = url ||= URL.createObjectURL(m.data);
        media.removeAttribute("data-drop-media");
      }
      return;
    }
    if (!String(m.data).startsWith("data:image/")) return;
    for (const image of document.querySelectorAll("img[data-drop-image]")) {
      if (image.dataset.dropImage !== m.path) continue;
      image.src = m.data;
      image.removeAttribute("data-drop-image");
    }
  });
})()`

const EMBEDS_SCRIPT = String.raw`(() => {
  const boxes = document.querySelectorAll("[data-drop-embed]");
  if (!boxes.length) return;
  const asked = new Set();
  const near = new IntersectionObserver((entries) => {
    const links = [];
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      near.unobserve(entry.target);
      const link = entry.target.dataset.dropEmbed;
      if (link && !asked.has(link)) { asked.add(link); links.push(link); }
    }
    if (links.length) parent.postMessage({ __drop: true, type: "embeds", links }, "*");
  }, { root: document, rootMargin: "150% 0px" });
  boxes.forEach((box) => near.observe(box));
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent || m.type !== "embed-data") return;
    for (const box of document.querySelectorAll("[data-drop-embed]")) {
      if (box.dataset.dropEmbed !== m.link) continue;
      box.removeAttribute("data-drop-embed");
      if (typeof m.html !== "string") {
        const note = document.createElement("p");
        note.className = "drop-embed-note";
        note.textContent = String(m.error || "This drop can't show here.");
        box.replaceChildren(note);
        continue;
      }
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.title = box.dataset.title || "Embedded drop";
      frame.srcdoc = m.html;
      box.replaceChildren(frame);
    }
  });
})()`

const SHEET_CSS = `
body { margin: 0; background: var(--background); color: var(--foreground); transition: padding-right .2s ease-out; padding-right: var(--drop-inset, 0px); }
.sheets { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; padding: 1.5rem; gap: .75rem; }
.sheet-tabs { display: flex; gap: .25rem; flex-wrap: wrap; padding: .25rem; border-radius: var(--radius); background: var(--muted); align-self: flex-start; }
.sheet-tabs button { font: inherit; font-size: .8125rem; font-weight: 500; color: var(--muted-foreground); background: none; border: 0; border-radius: calc(var(--radius) - 4px); padding: .25rem .75rem; cursor: pointer; transition: color 150ms ease-out, background-color 150ms ease-out; }
.sheet-tabs button:hover { color: var(--foreground); }
.sheet-tabs button[aria-selected="true"] { color: var(--foreground); background: var(--background); box-shadow: 0 1px 2px rgb(0 0 0 / .06); }
.sheet { display: flex; flex-direction: column; min-height: 0; flex: 1; gap: .5rem; }
.sheet[hidden] { display: none; }
.sheet-scroll { overflow: auto; min-height: 0; align-self: flex-start; max-width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
table { border-collapse: separate; border-spacing: 0; font-size: .8125rem; line-height: 1.4; }
th, td { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: .375rem .625rem; white-space: nowrap; max-width: 28rem; overflow: hidden; text-overflow: ellipsis; text-align: left; vertical-align: top; }
td.n { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
td.b { font-weight: 600; }
thead th { position: sticky; top: 0; z-index: 1; background: var(--muted); color: var(--muted-foreground); font-weight: 500; font-size: .75rem; text-align: center; }
tbody th { position: sticky; left: 0; background: var(--muted); color: var(--muted-foreground); font-weight: 400; font-size: .75rem; font-family: var(--font-mono); text-align: right; min-width: 2rem; }
thead th.corner { left: 0; z-index: 2; }
tbody tr:hover td { background: var(--accent); }
tbody tr:last-child > * { border-bottom: 0; }
tr > :last-child { border-right: 0; }
.sheet-note, .sheet-empty { margin: 0; font-size: .8125rem; color: var(--muted-foreground); }
.sheet-empty { margin: auto; }
`

const SHEET_TABS_SCRIPT = String.raw`(() => {
  const tabs = [...document.querySelectorAll(".sheet-tabs button")];
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((other) => other.setAttribute("aria-selected", String(other === tab)));
    document.querySelectorAll(".sheet").forEach((sheet) => { sheet.hidden = sheet.dataset.sheet !== tab.dataset.sheet; });
  }));
})()`

const OUTLINE_HEADING_SCRIPT = String.raw`document.addEventListener("click", (event) => {
  const link = event.target instanceof Element && event.target.closest(".cto-rail a[href^='#']");
  const id = link && decodeURIComponent(link.getAttribute("href").slice(1));
  if (id && document.getElementById(id)) parent.postMessage({ __drop: true, type: "heading", id }, "*");
})`

export function planDocument(
  kind: PlanKind,
  source: string,
  dark = false,
  html = "",
  inset = 0,
  width: DocWidth = "readable",
  zen = false,
): string {
  if (kind === "html") return injectRuntime(source, dark, inset, true)
  if (kind === "image") {
    const src = source.trim().startsWith("<svg")
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
      : source
    return injectRuntime(
      `<!doctype html><html style="overscroll-behavior-x:none"><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:var(--muted)"><img src="${escapeHtml(src)}" style="max-width:min(100%,960px);box-shadow:0 10px 40px rgb(0 0 0/.15);border-radius:10px" alt=""></body></html>`,
      dark,
    )
  }
  if (kind === "file" && html) {
    return injectRuntime(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${THEME_CSS}${SHEET_CSS}</style></head><body><main class="sheets">${html}</main><script>${SHEET_TABS_SCRIPT}</script></body></html>`,
      dark,
      inset,
    )
  }
  if (kind === "file") {
    return injectRuntime(
      `<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;color:var(--muted-foreground)">No preview for this file type.</body></html>`,
      dark,
    )
  }
  const relay = globalThis.location ? ` data-quiz-relay="${escapeHtml(globalThis.location.origin)}"` : ""
  return injectRuntime(
    `<!doctype html><html lang="en"${relay}${zen ? ' class="drop-zen"' : ""} style="--drop-column: ${DOC_WIDTHS[width]}"><head><meta charset="utf-8"><style>${TYPESET_CSS}${THEME_CSS}${DOCUMENT_EXTRA_CSS}</style></head><body><main><article class="typeset">${html}</article></main><script>${OUTLINE_HEADING_SCRIPT};${DEFERRED_FILES_SCRIPT};${EMBEDS_SCRIPT};${DOC_HEADER_SCRIPT}</script></body></html>`,
    dark,
    inset,
  )
}
