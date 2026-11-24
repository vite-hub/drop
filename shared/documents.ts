import { escapeUTF8 as escapeHtml } from "entities"
import type { PlanKind } from "./plans"
import { DOC_HEADER_SCRIPT } from "./doc-header"
import { EMBED_PAGES } from "./frame-messages"
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
/* A PDF, image or video (an attached PDF from the start, a drop once the viewer says what it is) takes its pages' or
   its media's own height in the doc's flow instead of the fixed frame height. */
.drop-embed:is([data-kind="pdf"], [data-kind="image"], [data-kind="video"]) { display: block; place-items: normal; height: auto; min-height: 0; }
.drop-embed:is([data-kind="pdf"], [data-kind="image"], [data-kind="video"]) > .drop-embed-link { display: block; padding: 1rem; text-align: center; }
.drop-embed-note { margin: 0; padding: 1rem; color: var(--muted-foreground); font-size: .875rem; text-align: center; }
/* A PDF's pages, one after another at the doc's width (an A4 page's room until the page arrives), with its web links
   over them and its drop's open comments as pins, which open the drop. The pins stay out of a printed doc. */
.drop-embed-page { position: relative; aspect-ratio: 1000 / 1414; background: var(--background); }
.drop-embed-page + .drop-embed-page { border-top: 1px solid var(--border); }
.typeset .drop-embed-page img { display: block; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; border-radius: 0; }
.drop-embed-pdf-link { position: absolute; border-radius: 2px; }
.drop-embed-pdf-link:hover { background: color-mix(in oklab, var(--foreground) 8%, transparent); }
.drop-embed-area { position: absolute; border: 1.5px solid color-mix(in oklab, var(--foreground) 22%, transparent); border-radius: 3px; pointer-events: none; }
.typeset .drop-embed-pin { position: absolute; translate: -50% -50%; display: grid; place-items: center; min-width: 1.375rem; height: 1.375rem; padding: 0 .3rem; box-sizing: border-box; border-radius: 999px; background: var(--foreground); color: var(--background); font-size: .6875rem; font-weight: 600; line-height: 1; text-decoration: none; box-shadow: 0 1px 3px rgb(0 0 0 / .25); }
.drop-embed-caption { padding: .5rem .75rem; border-top: 1px solid var(--border); font-size: .8125rem; color: var(--muted-foreground); }
.drop-embed[data-kind="image"] img { display: block; margin: 0 auto; }
.drop-embed[data-kind="video"] video { display: block; width: 100%; height: auto; }
@media print { .typeset :is(.drop-embed-pin, .drop-embed-area, .drop-embed-caption) { display: none; } .drop-embed-page { break-inside: avoid; } }
/* An image on its way (DEFERRED_FILES_SCRIPT) keeps a screenshot's room, so the text below doesn't jump as much. */
.typeset img[data-drop-image] { width: 100%; aspect-ratio: 16 / 10; background: var(--muted); }
`

const DEFERRED_FILES_SCRIPT = String.raw`(() => {
  const waiting = document.querySelectorAll("img[data-drop-image], [data-drop-media]");
  if (!waiting.length) return;
  const asked = new Set();
  const arrived = new Set();
  const ask = (elements) => {
    const paths = [];
    for (const element of elements) {
      near.unobserve(element);
      const path = element.dataset.dropImage || element.dataset.dropMedia;
      if (path && !asked.has(path)) { asked.add(path); paths.push(path); }
    }
    if (paths.length) parent.postMessage({ __drop: true, type: "files", paths }, "*");
  };
  // The document as root: a sandboxed frame is cross-origin, and browsers ignore rootMargin on its implicit root.
  const near = new IntersectionObserver((entries) => {
    ask(entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target));
  }, { root: document, rootMargin: "150% 0px" });
  waiting.forEach((element) => near.observe(element));
  // Export as PDF (plan-runtime) asks for the rest and prints once every file asked for is here.
  let onArrive = () => {};
  document.addEventListener("drop:print", (e) => {
    ask(waiting);
    e.detail.waitUntil(new Promise((resolve) => {
      onArrive = () => {
        e.detail.progress();
        if ([...asked].every((path) => arrived.has(path))) resolve();
      };
      onArrive();
    }));
  });
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent || m.type !== "file-data") return;
    arrived.add(m.path);
    onArrive();
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
  const boxes = [...document.querySelectorAll("[data-drop-embed], figure.drop-embed[data-drop-file]")];
  if (!boxes.length) return;
  const MAX_PAGES = ${EMBED_PAGES};
  const post = (message) => parent.postMessage({ __drop: true, ...message }, "*");
  const linkOf = new Map(boxes.map((box) => [box, box.dataset.dropEmbed || box.dataset.dropFile]));
  const asked = new Set();
  const arrived = new Set();
  let printing = false;
  let onArrive = () => {};
  const arrive = (link) => { arrived.add(link); onArrive(); };
  const ask = (elements) => {
    const links = [];
    for (const box of elements) {
      near.unobserve(box);
      const link = linkOf.get(box);
      if (link && !asked.has(link)) { asked.add(link); links.push(link); }
    }
    if (links.length) post({ type: "embeds", links });
  };
  const near = new IntersectionObserver((entries) => {
    ask(entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target));
  }, { root: document, rootMargin: "150% 0px" });
  boxes.forEach((box) => near.observe(box));

  // A PDF's pages: each asked for once it's near the screen, all of them for Export as PDF.
  const pdfs = new Map();
  const pageOf = new Map();
  const askPage = (link, n) => {
    const pdf = pdfs.get(link);
    if (!pdf || pdf.asked.has(n)) return;
    pdf.asked.add(n);
    post({ type: "embed-page", link, page: n });
  };
  const askPages = (link) => { for (let n = 1; n <= pdfs.get(link).count; n++) askPage(link, n); };
  const pageNear = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      pageNear.unobserve(entry.target);
      askPage(...pageOf.get(entry.target));
    }
  }, { root: document, rootMargin: "150% 0px" });

  // Export as PDF (plan-runtime) asks for the rest and prints once every box asked for shows its drop, every page of
  // its PDFs, or why it can't.
  document.addEventListener("drop:print", (e) => {
    printing = true;
    ask(boxes);
    for (const link of pdfs.keys()) askPages(link);
    e.detail.waitUntil(new Promise((resolve) => {
      onArrive = () => {
        e.detail.progress();
        if ([...asked].every((link) => arrived.has(link))) resolve();
      };
      onArrive();
    }));
  });
  addEventListener("afterprint", () => { printing = false; });

  const note = (text) => {
    const p = document.createElement("p");
    p.className = "drop-embed-note";
    p.textContent = text;
    return p;
  };
  // A drop opens in the viewer, or with a modifier key in a new tab as any link; an attached PDF opens as its file.
  const opener = (link, href, text) => {
    const a = document.createElement("a");
    a.href = href;
    if (text) a.textContent = text;
    if (link.startsWith("/f/")) { a.target = "_blank"; a.rel = "noopener noreferrer"; return a; }
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      post({ type: "doc-open", id: link });
    });
    return a;
  };
  const at = (element, x, y, w, h) => {
    element.style.left = x / 10 + "%";
    element.style.top = y / 10 + "%";
    if (w !== undefined) { element.style.width = w / 10 + "%"; element.style.height = h / 10 + "%"; }
    return element;
  };

  function showPdf(box, link, m) {
    const title = String(m.title || box.dataset.title || "PDF");
    const href = String(m.href || link);
    const total = Math.max(0, Number(m.pages) || 0);
    const pdf = pdfs.get(link) || { count: Math.min(total, MAX_PAGES), title, href, asked: new Set(), done: new Set() };
    pdfs.set(link, pdf);
    box.dataset.kind = "pdf";
    const nodes = [];
    for (let n = 1; n <= pdf.count; n++) {
      const page = document.createElement("div");
      page.className = "drop-embed-page";
      pageOf.set(page, [link, n]);
      pageNear.observe(page);
      nodes.push(page);
    }
    if (total > MAX_PAGES) {
      const rest = note("The doc shows the first " + MAX_PAGES + " of " + total + " pages. ");
      rest.append(opener(link, href, "Open " + title), " for the rest.");
      nodes.push(rest);
    }
    // Comments on a PDF drop's pages are its own: they show here as pins, and are read and written on the drop.
    if (!link.startsWith("/f/")) {
      const caption = document.createElement("figcaption");
      caption.className = "drop-embed-caption";
      caption.append(opener(link, href, "Open " + title));
      nodes.push(caption);
    }
    box.replaceChildren(...nodes);
    if (printing) askPages(link);
    if (!pdf.count) arrive(link);
  }

  function showPage(page, pdf, link, m) {
    page.style.aspectRatio = m.width + " / " + m.height;
    const image = document.createElement("img");
    image.src = m.src;
    image.width = m.width;
    image.height = m.height;
    image.alt = pdf.title + ", page " + m.page;
    const parts = [image];
    for (const target of Array.isArray(m.links) ? m.links : []) {
      if (!/^(?:https?:|mailto:)/i.test(String(target.href))) continue;
      const a = at(document.createElement("a"), target.x, target.y, target.w, target.h);
      a.className = "drop-embed-pdf-link";
      a.href = target.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", target.href);
      parts.push(a);
    }
    for (const pin of Array.isArray(m.pins) ? m.pins : []) {
      if (pin.w && pin.h) {
        const area = at(document.createElement("span"), pin.x, pin.y, pin.w, pin.h);
        area.className = "drop-embed-area";
        parts.push(area);
      }
      const dot = at(opener(link, pdf.href, String(pin.n)), pin.x, pin.y);
      dot.className = "drop-embed-pin";
      dot.setAttribute("aria-label", "Comment #" + pin.n + " on page " + m.page + ", open " + pdf.title + " to read it");
      parts.push(dot);
    }
    page.replaceChildren(...parts);
  }

  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent) return;
    if (m.type === "embed-page-data") {
      const pdf = pdfs.get(m.link);
      const drawn = String(m.src).startsWith("data:image/");
      if (!pdf || pdf.done.has(m.page) || (!drawn && typeof m.error !== "string")) return;
      for (const [page, [link, n]] of pageOf) {
        if (link !== m.link || n !== m.page) continue;
        if (drawn) showPage(page, pdf, link, m);
        else { page.style.aspectRatio = "auto"; page.replaceChildren(note("Page " + m.page + " couldn't be drawn.")); }
      }
      pdf.done.add(m.page);
      if (pdf.done.size >= pdf.count) arrive(m.link);
      else onArrive();
      return;
    }
    if (m.type !== "embed-data") return;
    for (const box of boxes) {
      if (linkOf.get(box) !== m.link || !box.isConnected) continue;
      box.removeAttribute("data-drop-embed");
      const title = box.dataset.title || "Embedded drop";
      if (m.kind === "pdf") { showPdf(box, m.link, m); continue; }
      if (m.kind === "image" && String(m.src).startsWith("data:image/")) {
        const image = document.createElement("img");
        image.alt = title;
        image.addEventListener("load", () => arrive(m.link), { once: true });
        image.addEventListener("error", () => arrive(m.link), { once: true });
        image.src = m.src;
        box.dataset.kind = "image";
        box.replaceChildren(image);
        continue;
      }
      if (m.kind === "video" && m.data instanceof Blob) {
        const video = document.createElement("video");
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = URL.createObjectURL(m.data);
        box.dataset.kind = "video";
        box.replaceChildren(video);
        arrive(m.link);
        continue;
      }
      if (typeof m.html !== "string") {
        box.replaceChildren(note(String(m.error || "This drop can't show here.")));
        arrive(m.link);
        continue;
      }
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.title = title;
      frame.srcdoc = m.html;
      frame.addEventListener("load", () => arrive(m.link), { once: true });
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
