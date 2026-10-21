// The documents the viewer's sandboxed iframe shows. Markdown arrives already rendered by the server's Comark
// renderer (see server/utils/markdown-document.ts), so every Markdown drop looks the same at /f/ and in Drop.
import { escapeUTF8 as escapeHtml } from "entities"
import type { PlanKind } from "./plans"
import { injectRuntime, THEME_CSS } from "./plan-runtime"
import { CALLOUT_CSS, TYPESET_CSS } from "./typeset"

const DOCUMENT_EXTRA_CSS =
  CALLOUT_CSS +
  `
/* The text moves left only as far as it must to clear the viewer's floating panel (--drop-inset). Once the column
   can't fit beside it, the column narrows: the panel never covers the text. The outline can set --drop-outline and
   --drop-shift itself, to keep a column of its own (OUTLINE_SCRIPT); a compare keeps clear of both (document-shell.css). */
body { margin: 0; background: var(--background); color: var(--foreground); transition: padding-right .2s ease-out;
  --drop-right: calc(var(--drop-inset, 0px) + var(--drop-outline, 0px));
  --drop-shift: clamp(0px, calc(2 * var(--drop-inset, 0px) + 46rem - 100vw), max(0px, calc(var(--drop-inset, 0px) - 1.5rem)));
  padding-right: var(--drop-shift); }
main { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
.task-list-item { list-style: none; margin-left: -1.25rem; }
.mermaid { display: flex; justify-content: center; margin: 1.5rem 0; }
.mermaid svg { max-width: 100%; height: auto; }
.typeset :is(h2, h3) { scroll-margin-top: 1.5rem; }
`

/**
 * A spreadsheet's preview (server/utils/spreadsheet.ts): Drop's table look from the docs, as a grid. The column letters
 * and row numbers stay put while the cells scroll, like a spreadsheet's, and numbers line up right in Geist Mono.
 */
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

/** Switches the sheet showing when a workbook has more than one. */
const SHEET_TABS_SCRIPT = String.raw`(() => {
  const tabs = [...document.querySelectorAll(".sheet-tabs button")];
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((other) => other.setAttribute("aria-selected", String(other === tab)));
    document.querySelectorAll(".sheet").forEach((sheet) => { sheet.hidden = sheet.dataset.sheet !== tab.dataset.sheet; });
  }));
})()`

/**
 * The doc's outline, Docus-style but plain: its h2 and h3 headings in the room right of the text column, the one
 * being read marked. It only shows where it fits beside the column and clear of the viewer's floating panel
 * (--drop-inset). It draws in a shadow root, so comments never take its headings for the doc's own text.
 */
const OUTLINE_SCRIPT = String.raw`(() => {
  const headings = [...document.querySelectorAll(".typeset h2, .typeset h3")].filter((heading) => heading.textContent.trim());
  const main = document.querySelector("main");
  if (headings.length < 2 || !main) return;
  const host = document.createElement("drop-outline");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<style>" +
    ":host{position:fixed;top:3.5rem;display:none;max-height:calc(100vh - 7rem);overflow-y:auto;font-size:.8125rem;line-height:1.4;scrollbar-width:none}" +
    ":host([data-fits]){display:block}nav p{margin:0 0 .5rem;color:var(--foreground);font-weight:500}" +
    "ol{margin:0;padding:0;list-style:none}a{display:block;padding:.25rem 0;color:var(--muted-foreground);text-decoration:none;text-wrap:pretty;transition:color 150ms ease-out}" +
    "a.sub{padding-left:.75rem}a:hover,a[aria-current]{color:var(--foreground)}@media print{:host{display:none!important}}" +
    "</style><nav aria-label='On this page'><p>On this page</p><ol></ol></nav>";
  const list = shadow.querySelector("ol");
  const links = headings.map((heading) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = heading.id ? "#" + heading.id : "#";
    link.textContent = heading.textContent.trim();
    if (heading.tagName === "H3") link.className = "sub";
    link.onclick = (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    item.append(link);
    list.append(item);
    return link;
  });
  document.body.append(host);

  // A compare spreads past the text into the room beside it, where the outline goes. So in a doc with one, the outline
  // keeps a 200px column 4rem right of the compares, and the text moves left only as far as that needs (like for the
  // viewer's panel). It only shows while the compares keep at least the text's width.
  const wide = document.querySelector(".typeset .ca-compare");
  const column = 264;
  const right = "(var(--drop-inset, 0px) + " + column + "px)";
  function place() {
    const inset = parseFloat(document.documentElement.style.getPropertyValue("--drop-inset")) || 0;
    if (wide) {
      const fits = innerWidth - inset - column - 48 >= main.getBoundingClientRect().width;
      const body = document.body.style;
      if (fits) {
        body.setProperty("--drop-outline", column + "px");
        body.setProperty("--drop-shift", "clamp(0px, calc(2 * " + right + " + 75rem - 100vw), calc" + right + ")");
      } else {
        body.removeProperty("--drop-outline");
        body.removeProperty("--drop-shift");
      }
      host.toggleAttribute("data-fits", fits);
      host.style.left = Math.min(wide.getBoundingClientRect().right + 64, innerWidth - inset - 224) + "px";
      host.style.width = "200px";
      return;
    }
    // The text ends 1.5rem inside <main>. The outline keeps 4rem clear of it, closing to 2.5rem only when its full
    // 15rem width needs the room, and never drifts further out on wide screens.
    const text = main.getBoundingClientRect().right - 24;
    const space = innerWidth - inset - 24 - text;
    const gap = Math.min(64, Math.max(40, space - 240));
    host.toggleAttribute("data-fits", space - gap >= 176);
    host.style.left = text + gap + "px";
    host.style.width = Math.min(space - gap, 240) + "px";
  }
  function mark() {
    let current = 0;
    headings.forEach((heading, index) => { if (heading.getBoundingClientRect().top <= 96) current = index; });
    links.forEach((link, index) => index === current ? link.setAttribute("aria-current", "location") : link.removeAttribute("aria-current"));
  }
  // The column opens without sliding the text over on load.
  document.body.style.transition = "none";
  place();
  void document.body.offsetWidth;
  document.body.style.transition = "";
  mark();
  addEventListener("resize", place);
  addEventListener("scroll", mark, { passive: true });
  // The viewer's panel opening or closing sets --drop-inset, and the column slides over .2s (body's padding).
  new MutationObserver(place).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  document.body.addEventListener("transitionend", place);
})()`

/**
 * Builds the exact document an iframe shows for a drop, with Drop's theme and annotator injected. `html` is the
 * server-rendered body for Markdown, and a spreadsheet's sheets for a file.
 */
export function planDocument(kind: PlanKind, source: string, dark = false, html = "", inset = 0): string {
  if (kind === "html") return injectRuntime(source, dark, inset)
  if (kind === "image") {
    const src = source.trim().startsWith("<svg")
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
      : source
    return injectRuntime(
      `<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:var(--muted)"><img src="${escapeHtml(src)}" style="max-width:min(100%,960px);box-shadow:0 10px 40px rgb(0 0 0/.15);border-radius:10px" alt=""></body></html>`,
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
  // Theme comes after typeset so its tokens win at equal specificity.
  return injectRuntime(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${TYPESET_CSS}${THEME_CSS}${DOCUMENT_EXTRA_CSS}</style></head><body><main><article class="typeset">${html}</article></main><script>${OUTLINE_SCRIPT}</script></body></html>`,
    dark,
    inset,
  )
}
