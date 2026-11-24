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
   over them and its drop's comments as pins, which open the drop. The pins and areas are ViewerPdf's: the pin's sharp
   corner on the spot, resolved ones greyed. The pins stay out of a printed doc, and so do the box's background and
   border, which would show as a band where a page prints narrower than the paper. */
.drop-embed-page { position: relative; aspect-ratio: var(--drop-page-ratio, 1000 / 1414); background: var(--background); }
.drop-embed-page + .drop-embed-page { border-top: 1px solid var(--border); }
.typeset .drop-embed-page img { display: block; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; border-radius: 0; }
.drop-embed-pdf-link { position: absolute; border-radius: 2px; }
.drop-embed-pdf-link:hover { background: color-mix(in oklab, var(--foreground) 8%, transparent); }
.drop-embed-area { position: absolute; z-index: 4; box-sizing: border-box; border: 2px solid var(--primary); border-radius: 2px; background: color-mix(in srgb, var(--primary) 8%, transparent); pointer-events: none; }
.typeset .drop-embed-pin { position: absolute; z-index: 5; box-sizing: border-box; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 2px 11px 11px 11px; background: var(--primary); color: var(--primary-foreground); font: 600 10px/22px var(--font-sans); font-variant-numeric: tabular-nums; text-align: center; text-decoration: none; box-shadow: 0 1px 4px rgb(0 0 0 / .25), 0 0 0 2px var(--background); transition: scale 150ms cubic-bezier(.23, 1, .32, 1); transform-origin: top left; }
.typeset .drop-embed-pin:hover { scale: 1.1; }
.typeset .drop-embed-pin:active { scale: .96; }
.typeset .drop-embed-pin:focus-visible { outline: 2px solid var(--foreground); outline-offset: 2px; }
.typeset :is(.drop-embed-pin, .drop-embed-area).done { opacity: .55; filter: grayscale(1); }
@media (prefers-reduced-motion: reduce) { .typeset .drop-embed-pin { transition: none; } }
.drop-embed-caption { padding: .5rem .75rem; border-top: 1px solid var(--border); font-size: .8125rem; color: var(--muted-foreground); }
.drop-embed[data-kind="image"] img { display: block; margin: 0 auto; }
.drop-embed[data-kind="video"] video { display: block; width: 100%; height: auto; }
/* A printed PDF page fits on one sheet with room for main's padding (3.5rem above, 6rem below), so the doc's first and
   last sheets hold one too: a page taller than that prints narrower. */
@media print { .typeset :is(.drop-embed-pin, .drop-embed-area, .drop-embed-caption) { display: none; } .drop-embed-page { break-inside: avoid; width: min(100%, (100vh - 9.5rem) * var(--drop-page-ratio, 1000 / 1414)); margin-inline: auto; } .drop-embed[data-kind="pdf"], .drop-embed-page { border: 0; background: none; } }
/* An image on its way (DEFERRED_FILES_SCRIPT) keeps a screenshot's room, so the text below doesn't jump as much. */
.typeset img[data-drop-image] { width: 100%; aspect-ratio: 16 / 10; background: var(--muted); }
`

const DEFERRED_FILES_SCRIPT = String.raw`(() => {
  const waiting = document.querySelectorAll("img[data-drop-image], [data-drop-media]");
  if (!waiting.length) return;
  const asked = new Set();
  const arrived = new Set();
  // Videos with their file but no frame yet: one without a poster prints blank until its first frame draws.
  const loading = new Set();
  const ask = (elements) => {
    const paths = [];
    for (const element of elements) {
      near.unobserve(element);
      const path = element.dataset.dropImage || element.dataset.dropMedia;
      if (path && !asked.has(path)) { asked.add(path); paths.push(path); }
    }
    // The viewer takes at most 100 paths a message (shared/frame-messages.ts).
    for (let i = 0; i < paths.length; i += 100) parent.postMessage({ __drop: true, type: "files", paths: paths.slice(i, i + 100) }, "*");
  };
  // The document as root: a sandboxed frame is cross-origin, and browsers ignore rootMargin on its implicit root.
  const near = new IntersectionObserver((entries) => {
    ask(entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target));
  }, { root: document, rootMargin: "150% 0px" });
  waiting.forEach((element) => near.observe(element));
  // Export as PDF (plan-runtime) asks for the rest and prints once every file asked for is here and every video shows a frame.
  let onArrive = () => {};
  let printing = false;
  // Safari stops a metadata-only video before its first frame, so a print asks for the whole file.
  const fetchFrame = (media) => {
    if (media.getAttribute("preload") === "auto") return;
    media.preload = "auto";
    media.load();
  };
  document.addEventListener("drop:print", (e) => {
    printing = true;
    loading.forEach(fetchFrame);
    ask(waiting);
    e.detail.waitUntil(new Promise((resolve) => {
      onArrive = () => {
        e.detail.progress();
        if (!loading.size && [...asked].every((path) => arrived.has(path))) resolve();
      };
      onArrive();
    }));
  });
  const firstFrame = (media) => {
    if (media.tagName !== "VIDEO" || media.poster || media.readyState >= 2 || media.error) return;
    loading.add(media);
    const done = () => {
      media.removeEventListener("loadeddata", done);
      media.removeEventListener("error", done);
      loading.delete(media);
      onArrive();
    };
    media.addEventListener("loadeddata", done);
    media.addEventListener("error", done);
    if (printing) fetchFrame(media);
  };
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent || m.type !== "file-data") return;
    arrived.add(m.path);
    if (m.data instanceof Blob) {
      let url;
      for (const media of document.querySelectorAll("[data-drop-media]")) {
        if (media.dataset.dropMedia !== m.path) continue;
        media.src = url ||= URL.createObjectURL(m.data);
        media.removeAttribute("data-drop-media");
        firstFrame(media);
      }
      onArrive();
      return;
    }
    onArrive();
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
  // Images, videos and frames still loading: a link embedded twice is fetched once and fills every box, and each copy
  // loads on its own.
  const loading = new Set();
  const pending = (element, ready) => {
    loading.add(element);
    const done = () => { loading.delete(element); onArrive(); };
    element.addEventListener(ready, done, { once: true });
    element.addEventListener("error", done, { once: true });
  };
  // A video's bytes play from an object URL, let go once its box shows something else or the doc goes.
  const videoUrls = new Map();
  const letGo = (box) => { if (videoUrls.has(box)) { URL.revokeObjectURL(videoUrls.get(box)); videoUrls.delete(box); } };
  addEventListener("pagehide", () => { for (const box of [...videoUrls.keys()]) letGo(box); });
  const ask = (elements) => {
    const links = [];
    for (const box of elements) {
      near.unobserve(box);
      const link = linkOf.get(box);
      if (link && !asked.has(link)) { asked.add(link); links.push(link); }
    }
    // The viewer takes at most 20 links a message (shared/frame-messages.ts).
    for (let i = 0; i < links.length; i += 20) post({ type: "embeds", links: links.slice(i, i + 20) });
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
        if (!loading.size && [...asked].every((link) => arrived.has(link))) resolve();
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
  // A drop opens in the viewer for a signed-in reader (the viewer's "view" says who reads), or with a modifier key in a
  // new tab as any link. A reader who isn't signed in follows the link to the drop's public page, as any /d/ link in a
  // doc opens. An attached PDF opens as its file.
  let signedIn = false;
  const opener = (link, href, text) => {
    const a = document.createElement("a");
    a.href = href;
    if (text) a.textContent = text;
    if (link.startsWith("/f/")) { a.target = "_blank"; a.rel = "noopener noreferrer"; return a; }
    a.addEventListener("click", (e) => {
      if (!signedIn || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
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
    page.style.setProperty("--drop-page-ratio", m.width + " / " + m.height);
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
        area.className = "drop-embed-area" + (pin.resolved ? " done" : "");
        parts.push(area);
      }
      const dot = at(opener(link, pdf.href, String(pin.n)), pin.x, pin.y);
      dot.className = "drop-embed-pin" + (pin.resolved ? " done" : "");
      dot.setAttribute("aria-label", "Comment #" + pin.n + (pin.resolved ? ", resolved," : "") + " on page " + m.page + ", open " + pdf.title + " to read it");
      parts.push(dot);
    }
    page.replaceChildren(...parts);
  }

  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent) return;
    if (m.type === "view") { signedIn = !!m.me; return; }
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
      letGo(box);
      const title = box.dataset.title || "Embedded drop";
      if (m.kind === "pdf") { showPdf(box, m.link, m); continue; }
      if (m.kind === "image" && String(m.src).startsWith("data:image/")) {
        const image = document.createElement("img");
        image.alt = title;
        pending(image, "load");
        image.src = m.src;
        box.dataset.kind = "image";
        box.replaceChildren(image);
        continue;
      }
      if (m.kind === "video" && m.data instanceof Blob) {
        const video = document.createElement("video");
        video.controls = true;
        video.playsInline = true;
        // Its first frame, so a printed doc shows it.
        video.preload = "auto";
        pending(video, "loadeddata");
        const url = URL.createObjectURL(m.data);
        videoUrls.set(box, url);
        video.src = url;
        box.dataset.kind = "video";
        box.replaceChildren(video);
        continue;
      }
      if (typeof m.html !== "string") {
        const why = note(String(m.error || "This drop can't show here."));
        if (typeof m.href === "string") why.append(opener(m.link, m.href, box.dataset.title || m.href));
        box.replaceChildren(why);
        continue;
      }
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.title = title;
      frame.srcdoc = m.html;
      pending(frame, "load");
      box.replaceChildren(frame);
    }
    // A PDF arrives once its pages have; anything else once each copy of it is in place.
    if (m.kind !== "pdf" || !pdfs.has(m.link)) arrive(m.link);
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
