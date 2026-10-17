// What Drop injects into every plan document.
// The theme contract matches T3 Code's HTML renders (same shadcn token names, --chart-1…6, base stylesheet),
// so a page an agent built for T3 renders the same way in Drop.

const LIGHT = `
  --background: #ffffff; --foreground: #111111; --card: #ffffff; --card-foreground: #111111; --popover: #ffffff; --popover-foreground: #111111;
  --muted: #f5f5f5; --muted-foreground: #666666; --secondary: #fafafa; --secondary-foreground: #111111;
  --border: #eaeaea; --input: #d4d4d4; --ring: #888888; --primary: #0a0a0a; --primary-foreground: #ffffff;
  --accent: #f5f5f5; --accent-foreground: #111111; --accent-surface: #f5f5f5; --accent-surface-foreground: #111111;
  --destructive: #b4261a; --destructive-foreground: #ffffff; --destructive-surface: #fdf0ef;
  --warning: #92400e; --warning-foreground: #ffffff; --warning-surface: #fff7ed;
  --success: #10b981; --success-foreground: #ffffff; --info: #3b82f6; --info-foreground: #ffffff;
  --code-background: #fafafa; --code-foreground: #111111;
  --chart-1: #64748b; --chart-2: #3b82f6; --chart-3: #b4795a; --chart-4: #14b8a6; --chart-5: #8b5cf6; --chart-6: #c2603d; --chart-7: #6b8e4e; --chart-8: #a3708f;
  --positive: #16a34a; --caution: #d97706; --negative: #dc2626;`;

const DARK = `
  --background: #0a0a0a; --foreground: #ededed; --card: #0f0f0f; --card-foreground: #ededed; --popover: #141414; --popover-foreground: #ededed;
  --muted: #1a1a1a; --muted-foreground: #9a9a9a; --secondary: #141414; --secondary-foreground: #ededed;
  --border: #1f1f1f; --input: #333333; --ring: #777777; --primary: #ffffff; --primary-foreground: #0a0a0a;
  --accent: #1a1a1a; --accent-foreground: #ededed; --accent-surface: #1a1a1a; --accent-surface-foreground: #ededed;
  --destructive: #e0726a; --destructive-foreground: #0a0a0a; --destructive-surface: #2a1513;
  --warning: #fbbf24; --warning-foreground: #0a0a0a; --warning-surface: #2a2009;
  --success: #34d399; --success-foreground: #052e1c; --info: #60a5fa; --info-foreground: #0b1b33;
  --code-background: #141414; --code-foreground: #ededed;
  --chart-1: #94a3b8; --chart-2: #60a5fa; --chart-3: #d4a088; --chart-4: #2dd4bf; --chart-5: #a78bfa; --chart-6: #e0866a; --chart-7: #93b874; --chart-8: #c99bb7;
  --positive: #4ade80; --caution: #fbbf24; --negative: #f87171;`;

const SHARED = `--radius: 0.5rem; --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif; --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;`;

export const THEME_CSS = `@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap");
:root { color-scheme: light; ${SHARED} ${LIGHT} }
:root.dark { color-scheme: dark; ${DARK} }
html { background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
body { margin: 0; }
code, kbd, pre, samp { font-family: var(--font-mono); }`;

/** The rules agents follow when they build an HTML plan. Shown on the Agents page and shipped in the skill. */
export const PLAN_AUTHORING_GUIDE = `Write one self-contained HTML document with inline <style> and <script>. Load libraries from a CDN (Chart.js, Mermaid, D3, KaTeX); they run as-is.
Drop shows the page full screen, so center a readable column (max-width ~760px) with its own padding.
Drop injects its theme as CSS custom properties on :root and follows the reader's light/dark mode: --background, --foreground, --muted, --muted-foreground, --card, --border, --primary, --primary-foreground, --destructive, --code-background, --chart-1 … --chart-8 (use in order), --positive, --caution, --negative, --radius, --font-sans, --font-mono. Use them instead of fixed colors. Grayscale first: color only for chart series and status.
Readers comment by selecting text, clicking images, or drawing a rectangle over any part of the page, so prefer real text, lists, and tables over text baked into images.
These are the same tokens T3 Code injects into HTML renders, so a page built for T3 looks the same here.`;

/**
 * Comment layer. Runs inside the drop's frame, on another origin than Drop, so it only talks to Drop via postMessage.
 * Select text to comment on it; click an image to zoom and comment on a spot; in area mode (Drop's R), drag a rectangle.
 * Commented text is highlighted with the CSS Custom Highlight API and everything else draws in a shadow root, so the
 * author's DOM is never modified.
 */
export const ANNOTATOR_SCRIPT = String.raw`(() => {
  const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
  const host = document.createElement("drop-comments");
  host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<style>' +
    '.m{position:absolute;width:20px;height:20px;margin:-10px 0 0 -2px;border-radius:10px 10px 10px 2px;background:var(--primary);color:var(--primary-foreground);font:500 11px/20px var(--font-mono);text-align:center;cursor:pointer;box-shadow:0 1px 4px rgb(0 0 0/.25),0 0 0 2px var(--background);transition:transform 120ms}' +
    '.m:hover{transform:scale(1.15)}.m.done{background:var(--muted-foreground);opacity:.6}.m.img{margin:-10px 0 0 -10px;border-radius:10px}' +
    '.m.pulse{animation:p 900ms ease-out 2}@keyframes p{50%{transform:scale(1.4)}}' +
    '.cp{position:absolute;display:flex;gap:6px;align-items:center;height:22px;padding:0 7px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--muted-foreground);font:500 11px var(--font-mono);cursor:pointer}' +
    '.cp:hover{color:var(--foreground)}.cp b{font-weight:500;text-transform:uppercase;letter-spacing:.06em;opacity:.7}' +
    '.a{position:absolute;box-sizing:border-box;border:1.5px solid var(--foreground);border-radius:3px;background:color-mix(in oklab,var(--foreground) 6%,transparent);pointer-events:none;transition:background 120ms}' +
    '.a.done{border-style:dashed;border-color:var(--muted-foreground);background:none;opacity:.6}.a.pulse{background:color-mix(in oklab,var(--foreground) 16%,transparent)}' +
    '.draw{position:fixed;inset:0;cursor:crosshair;touch-action:none}.draw .a{position:fixed}' +
    '</style><div class="marks"></div><div class="draft"></div>';
  const marks = shadow.querySelector(".marks"), draft = shadow.querySelector(".draft");
  const pageStyle = document.createElement("style");
  pageStyle.textContent = "::highlight(drop-open){background:color-mix(in oklab,var(--foreground) 13%,transparent);text-decoration:underline;text-decoration-color:color-mix(in oklab,var(--foreground) 45%,transparent);text-underline-offset:3px}::highlight(drop-done){background:color-mix(in oklab,var(--foreground) 6%,transparent)}::highlight(drop-active){background:color-mix(in oklab,var(--foreground) 26%,transparent)}img{cursor:zoom-in}";
  let markers = [], active = null;
  const highlights = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";

  function pathOf(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement && parts.length < 10) {
      let part = el.tagName.toLowerCase();
      if (el.id && /^[a-z][\w-]*$/i.test(el.id)) { parts.unshift("#" + el.id); break; }
      const same = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName) : [];
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function labelOf(el) {
    const text = (el.innerText || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ");
    const name = el.tagName.toLowerCase();
    return text ? name + ' "' + (text.length > 40 ? text.slice(0, 40) + "…" : text) + '"' : name;
  }
  const query = (selector) => { try { return (selector && document.querySelector(selector)) || null; } catch (e) { return null; } };
  const BLOCK = /^(p|li|td|th|h[1-6]|blockquote|pre|figcaption|dd|dt|label|section|article|main|div)$/i;
  function blockOf(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body && !BLOCK.test(el.tagName)) el = el.parentElement;
    return el || document.body;
  }

  function findRange(selector, quote) {
    for (const root of [query(selector), document.body]) {
      if (!root) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = []; let text = "";
      while (walker.nextNode()) { nodes.push([walker.currentNode, text.length]); text += walker.currentNode.data; }
      const at = text.indexOf(quote);
      if (at < 0) continue;
      const range = document.createRange();
      // Start snaps forward into the node that begins at the offset; end snaps back into the node that ends there.
      const locate = (offset, end) => { for (let i = nodes.length - 1; i >= 0; i--) if (end ? nodes[i][1] < offset : nodes[i][1] <= offset) return [nodes[i][0], offset - nodes[i][1]]; return [nodes[0][0], 0]; };
      const [sn, so] = locate(at, false), [en, eo] = locate(at + quote.length, true);
      range.setStart(sn, so); range.setEnd(en, Math.min(eo, en.data.length));
      return range;
    }
    return null;
  }

  /** An outlined rectangle at page coordinates, for saved areas and the one being commented on. */
  function areaBox(parentEl, left, top, width, height, className) {
    const box = document.createElement("div");
    box.className = "a" + (className || "");
    box.style.cssText = "left:" + left + "px;top:" + top + "px;width:" + width + "px;height:" + height + "px";
    parentEl.appendChild(box);
    return box;
  }

  /**
   * Whether an element still is what a comment from an earlier version pointed at. The selector is a position in the
   * page, so it also matches whatever took that place; the label (tag and first words, or the image's alt) tells.
   */
  function sameAnchor(el, m) {
    if (!m.label) return true;
    return m.kind === "image" ? (el.getAttribute("alt") || "image") === m.label : labelOf(el) === m.label;
  }

  let lastUnplaced = null;
  function render() {
    marks.innerHTML = "";
    const open = [], done = [], act = [], unplaced = [];
    for (const m of markers) {
      let x, y;
      if (m.kind === "image" || m.kind === "area") {
        // Placed from the anchor's current box, so areas and pins follow reflow.
        const el = query(m.selector);
        if (!el || (m.earlier && !sameAnchor(el, m))) { unplaced.push(m.id); continue; }
        resized.observe(el);
        const r = el.getBoundingClientRect();
        x = r.left + scrollX + (m.ox / 1000) * r.width; y = r.top + scrollY + (m.oy / 1000) * r.height;
        if (m.ow || m.oh) areaBox(marks, x, y, (m.ow / 1000) * r.width, (m.oh / 1000) * r.height, (m.resolved ? " done" : "") + (m.id === active ? " pulse" : ""));
      } else {
        // The quote is searched in its block first, then the whole page, so text that moved keeps its comment.
        const range = m.quote ? findRange(m.selector, m.quote) : null;
        if (!range) { unplaced.push(m.id); continue; }
        (m.id === active ? act : m.resolved ? done : open).push(range);
        const rects = range.getClientRects(), last = rects[rects.length - 1];
        if (!last) continue;
        x = last.right + scrollX + 2; y = last.top + scrollY;
      }
      const dot = document.createElement("div");
      dot.className = "m" + (m.kind !== "text" ? " img" : "") + (m.resolved ? " done" : "") + (m.id === active ? " pulse" : "");
      dot.textContent = String(m.n);
      dot.style.left = x + "px"; dot.style.top = y + "px";
      dot.onclick = (e) => { e.stopPropagation(); const r = dot.getBoundingClientRect(); post({ type: "marker", id: m.id, clientX: r.right, clientY: r.top }); };
      marks.appendChild(dot);
    }
    // T3-style code blocks: language + copy. The sandbox has no clipboard access, so Drop copies.
    document.querySelectorAll("pre:not(.mermaid)").forEach((pre) => {
      const r = pre.getBoundingClientRect();
      if (r.height < 24) return;
      const chip = document.createElement("button");
      chip.className = "cp";
      chip.innerHTML = (pre.dataset.lang && pre.dataset.lang !== "text" ? "<b></b>" : "") + "<span>Copy</span>";
      if (chip.querySelector("b")) chip.querySelector("b").textContent = pre.dataset.lang;
      marks.appendChild(chip);
      chip.style.left = r.right + scrollX - chip.offsetWidth - 8 + "px";
      chip.style.top = r.top + scrollY + 8 + "px";
      chip.onclick = (e) => {
        e.stopPropagation();
        post({ type: "copy", text: pre.innerText });
        chip.querySelector("span").textContent = "Copied";
        setTimeout(() => { chip.querySelector("span").textContent = "Copy"; }, 1400);
      };
    });
    // The viewer lists the comments it couldn't place; it only says so when that changes, since this runs on resize.
    if (unplaced.join() !== lastUnplaced) { lastUnplaced = unplaced.join(); post({ type: "unplaced", ids: unplaced }); }
    if (highlights) {
      CSS.highlights.set("drop-open", new Highlight(...open));
      CSS.highlights.set("drop-done", new Highlight(...done));
      CSS.highlights.set("drop-active", new Highlight(...act));
    }
  }

  let lastQuote = "";
  function reportSelection() {
    const sel = getSelection();
    const text = sel && sel.rangeCount ? sel.toString().trim().replace(/\s+/g, " ") : "";
    if (!text || host.contains(sel.anchorNode)) { if (lastQuote) post({ type: "selection", clear: true }); lastQuote = ""; return; }
    const range = sel.getRangeAt(0), r = range.getBoundingClientRect(), block = blockOf(range.commonAncestorContainer);
    lastQuote = text.slice(0, 500);
    post({ type: "selection", quote: lastQuote, selector: pathOf(block), label: labelOf(block), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  }
  let selectionTimer = 0;
  document.addEventListener("mouseup", () => setTimeout(reportSelection, 0));
  document.addEventListener("selectionchange", () => { clearTimeout(selectionTimer); selectionTimer = setTimeout(reportSelection, 250); });
  document.addEventListener("keyup", (e) => { if (e.shiftKey || e.key === "Shift") reportSelection(); });
  document.addEventListener("scroll", () => { if (lastQuote) reportSelection(); }, { passive: true });

  document.addEventListener("click", (e) => {
    const img = e.target && e.target.closest ? e.target.closest("img") : null;
    if (!img || host.contains(img) || (getSelection() && !getSelection().isCollapsed)) return;
    e.preventDefault(); e.stopPropagation();
    // The viewport rect lets Drop zoom the image out of the page instead of popping it open.
    const r = img.getBoundingClientRect();
    post({ type: "image", src: img.currentSrc || img.src, alt: img.alt || "", selector: pathOf(img), label: labelOf(img), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  }, true);

  // Area mode: a crosshair layer over the page. Drag a rectangle; it anchors to the smallest element that holds it.
  let drawing = null;
  function anchorFor(left, top, right, bottom) {
    const under = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).filter((el) => el !== host && el !== document.documentElement);
    let best = null, bestArea = Infinity;
    for (const el of under) {
      const r = el.getBoundingClientRect(), area = r.width * r.height;
      if (r.width < 1 || r.height < 1 || r.left > left + 1 || r.top > top + 1 || r.right < right - 1 || r.bottom < bottom - 1) continue;
      if (area < bestArea) { best = el; bestArea = area; }
    }
    return best || under[0] || document.body;
  }
  function finishArea(left, top, right, bottom) {
    const el = anchorFor(left, top, right, bottom), r = el.getBoundingClientRect();
    const at = (value, start, size) => Math.min(1000, Math.max(0, Math.round(((value - start) / (size || 1)) * 1000)));
    const ox = at(left, r.left, r.width), oy = at(top, r.top, r.height);
    // Keep the drawn rectangle on the page while the comment is written; Drop clears it.
    draft.innerHTML = "";
    areaBox(draft, left + scrollX, top + scrollY, right - left, bottom - top);
    post({ type: "area", selector: pathOf(el), label: labelOf(el), ox, oy, ow: at(right, r.left, r.width) - ox, oh: at(bottom, r.top, r.height) - oy, rect: { left, top, right, bottom } });
  }
  function setAreaMode(on) {
    if (on === Boolean(drawing)) return;
    if (!on) { drawing.remove(); drawing = null; return; }
    getSelection().removeAllRanges();
    if (lastQuote) post({ type: "selection", clear: true });
    lastQuote = "";
    drawing = document.createElement("div");
    drawing.className = "draw";
    let start = null, box = null;
    drawing.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drawing.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
    };
    drawing.onpointermove = (e) => {
      if (!start) return;
      const left = Math.min(start.x, e.clientX), top = Math.min(start.y, e.clientY), width = Math.abs(e.clientX - start.x), height = Math.abs(e.clientY - start.y);
      if (!box && Math.max(width, height) < 6) return;
      if (!box) box = areaBox(drawing, 0, 0, 0, 0);
      box.style.cssText = "left:" + left + "px;top:" + top + "px;width:" + width + "px;height:" + height + "px";
    };
    drawing.onpointerup = (e) => {
      if (!start) return;
      const s = start; start = null;
      // A click or a tiny drag draws nothing: stay in area mode.
      if (!box) return;
      box.remove(); box = null;
      setAreaMode(false);
      finishArea(Math.min(s.x, e.clientX), Math.min(s.y, e.clientY), Math.max(s.x, e.clientX), Math.max(s.y, e.clientY));
    };
    drawing.onpointercancel = () => { start = null; if (box) { box.remove(); box = null; } };
    shadow.appendChild(drawing);
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent) return;
    if (m.type === "markers") { markers = m.markers; render(); }
    if (m.type === "clear-selection") { getSelection().removeAllRanges(); lastQuote = ""; draft.innerHTML = ""; }
    if (m.type === "area-mode") setAreaMode(Boolean(m.on));
    if (m.type === "clear-area") draft.innerHTML = "";
    // How much of the right edge Drop's floating panel covers. Drop's own documents read it to stay clear.
    if (m.type === "inset") { document.documentElement.style.setProperty("--drop-inset", (Number(m.right) || 0) + "px"); render(); }
    if (m.type === "focus") {
      active = m.id; render();
      const dot = Array.from(marks.children).find((d) => d.classList.contains("pulse"));
      if (dot) scrollTo({ top: Math.max(0, parseFloat(dot.style.top) - innerHeight / 3), behavior: "smooth" });
      setTimeout(() => { active = null; render(); }, 2200);
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { setAreaMode(false); post({ type: "key", key: "Escape" }); }
    // Drop's area shortcut, for when the page has focus. Never while typing, and never once the page used the key.
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey && !e.altKey && !typing && !e.defaultPrevented) post({ type: "key", key: "r" });
  });
  window.addEventListener("resize", render);
  // The page and every anchor: an area must follow its element even when the page keeps its size.
  const resized = new ResizeObserver(render);
  resized.observe(document.documentElement);
  document.documentElement.appendChild(host);
  document.head.appendChild(pageStyle);
  post({ type: "ready" });
})();`;

/** Inject theme + annotator into a full HTML document without touching the author's markup. */
/**
 * In an opaque-origin sandbox (no content origin configured), storage, cookies, and URL changes throw a
 * SecurityError ("The operation is insecure"), which crashes apps that never expected it. Give them in-memory
 * storage and cookies for the page's lifetime, and let history calls keep their state without changing the URL.
 * On a real origin it does nothing.
 */
export const OPAQUE_ORIGIN_SHIM = String.raw`(() => {
  if (self.origin !== "null") return;
  const memory = () => {
    const data = new Map();
    return {
      get length() { return data.size; },
      key: (index) => [...data.keys()][index] ?? null,
      getItem: (key) => (data.has(String(key)) ? data.get(String(key)) : null),
      setItem: (key, value) => { data.set(String(key), String(value)); },
      removeItem: (key) => { data.delete(String(key)); },
      clear: () => data.clear(),
    };
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    try { window[name].length; } catch { Object.defineProperty(window, name, { value: memory(), configurable: true }); }
  }
  try { document.cookie; } catch {
    const jar = new Map();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => [...jar].map(([key, value]) => key + "=" + value).join("; "),
      set: (cookie) => {
        const [pair, ...attributes] = String(cookie).split(";");
        const at = pair.indexOf("=");
        const key = (at < 0 ? "" : pair.slice(0, at)).trim();
        const expired = attributes.some((attribute) => /^\s*max-age\s*=\s*(-\d+|0)\s*$/i.test(attribute) || (/^\s*expires\s*=/i.test(attribute) && Date.parse(attribute.split("=").slice(1).join("=")) < Date.now()));
        if (expired) jar.delete(key);
        else jar.set(key, (at < 0 ? pair : pair.slice(at + 1)).trim());
      },
    });
  }
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (state, title, url) {
      try { return original.call(this, state, title, url); }
      catch { return original.call(this, state, title); }
    };
  }
})();`;

/**
 * Reports the page's own failures to Drop so the agent that published it can read them: uncaught errors, rejected
 * promises nobody handled, console.error calls, and files that failed to load. Runs before the page's scripts.
 * At most 20 distinct reports per page load, each cut to 500 characters.
 */
export const ERROR_REPORTER = String.raw`(() => {
  const seen = new Set();
  const text = (value) => {
    if (value instanceof Error) return value.name + ": " + value.message;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const report = (kind, message, source) => {
    message = String(message || "").slice(0, 500);
    const key = kind + message + (source || "");
    if (!message || seen.has(key) || seen.size >= 20) return;
    seen.add(key);
    parent.postMessage({ __drop: true, type: "runtime-error", kind, message, source: source ? String(source).slice(0, 300) : undefined }, "*");
  };
  addEventListener("error", (event) => {
    const target = event.target;
    if (target && target !== window && (target.src || target.href)) return report("load", "Failed to load " + String(target.src || target.href).replace(location.origin, ""), target.tagName && target.tagName.toLowerCase());
    report("error", event.error ? text(event.error) : event.message, event.filename ? event.filename.replace(location.origin, "") + ":" + event.lineno : undefined);
  }, true);
  addEventListener("unhandledrejection", (event) => report("rejection", "Unhandled rejection: " + text(event.reason)));
  const original = console.error;
  console.error = function (...args) {
    report("console", args.map(text).join(" "));
    return original.apply(this, args);
  };
})();`;

/** Puts `snippet` first in the head, or after the doctype when there's no head tag, so the page keeps standards mode. */
export function prependToHead(html: string, snippet: string): string {
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (match) => match + snippet);
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? "";
  return doctype + snippet + html.slice(doctype.length);
}

export function injectRuntime(html: string, dark: boolean): string {
  const head = `<script>${ERROR_REPORTER}</script><script>${OPAQUE_ORIGIN_SHIM}</script><style data-drop-theme>${THEME_CSS}</style><script>document.documentElement.classList.toggle("dark", ${dark});</script>`;
  const tail = `<script>${ANNOTATOR_SCRIPT}</script>`;
  let out = prependToHead(html, head);
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, tail + "</body>") : out + tail;
  return out;
}
