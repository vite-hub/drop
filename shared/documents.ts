// The documents the viewer's sandboxed iframe shows. Markdown arrives already rendered by the server's Comark
// renderer (see server/utils/markdown-document.ts), so every Markdown drop looks the same at /f/ and in Drop.
import { escapeUTF8 as escapeHtml } from "entities"
import type { PlanKind } from "./plans"
import { injectRuntime, THEME_CSS } from "./plan-runtime"
import { CALLOUT_CSS, TYPESET_CSS } from "./typeset"

const DOCUMENT_EXTRA_CSS = CALLOUT_CSS + `
/* The text moves left only as far as it must to clear the viewer's floating panel (--drop-inset). Once the column
   can't fit beside it, the column narrows: the panel never covers the text. */
body { margin: 0; background: var(--background); color: var(--foreground); transition: padding-right .2s ease-out;
  padding-right: clamp(0px, calc(2 * var(--drop-inset, 0px) + 46rem - 100vw), max(0px, calc(var(--drop-inset, 0px) - 1.5rem))); }
main { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
.task-list-item { list-style: none; margin-left: -1.25rem; }
.mermaid { display: flex; justify-content: center; margin: 1.5rem 0; }
.mermaid svg { max-width: 100%; height: auto; }
.typeset :is(h2, h3) { scroll-margin-top: 1.5rem; }
`

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

  // The text ends 1.5rem inside <main>; 1rem past main's edge makes a 2.5rem gap.
  function place() {
    const left = main.getBoundingClientRect().right + 16;
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--drop-inset")) || 0;
    const room = innerWidth - inset - left - 24;
    host.toggleAttribute("data-fits", room >= 176);
    host.style.left = left + "px";
    host.style.width = Math.min(room, 240) + "px";
  }
  function mark() {
    let current = 0;
    headings.forEach((heading, index) => { if (heading.getBoundingClientRect().top <= 96) current = index; });
    links.forEach((link, index) => index === current ? link.setAttribute("aria-current", "location") : link.removeAttribute("aria-current"));
  }
  place();
  mark();
  addEventListener("resize", place);
  addEventListener("scroll", mark, { passive: true });
  // The viewer's panel opening or closing sets --drop-inset, and the column slides over .2s (body's padding).
  new MutationObserver(place).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  document.body.addEventListener("transitionend", place);
})()`

/**
 * Builds the exact document an iframe shows for a drop, with Drop's theme and annotator injected. `html` is the
 * server-rendered body for Markdown.
 */
export function planDocument(kind: PlanKind, source: string, dark = false, html = "", inset = 0): string {
  if (kind === "html") return injectRuntime(source, dark, inset)
  if (kind === "image") {
    const src = source.trim().startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` : source
    return injectRuntime(`<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:var(--muted)"><img src="${escapeHtml(src)}" style="max-width:min(100%,960px);box-shadow:0 10px 40px rgb(0 0 0/.15);border-radius:10px" alt=""></body></html>`, dark)
  }
  if (kind === "file") {
    return injectRuntime(`<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;color:var(--muted-foreground)">No preview for this file type.</body></html>`, dark)
  }
  // Theme comes after typeset so its tokens win at equal specificity.
  return injectRuntime(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${TYPESET_CSS}${THEME_CSS}${DOCUMENT_EXTRA_CSS}</style></head><body><main><article class="typeset">${html}</article></main><script>${OUTLINE_SCRIPT}</script></body></html>`, dark, inset)
}
