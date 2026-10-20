// What Drop injects into every plan document.
// The theme contract matches T3 Code's HTML renders (same shadcn token names, --chart-1…6, base stylesheet),
// so a page an agent built for T3 renders the same way in Drop.
import THEME from "./theme.css?raw"

const FONTS = `--font-sans: "Geist", ui-sans-serif, system-ui, sans-serif; --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;`

// The frame runs on another origin than Drop's assets, so Geist comes from Google Fonts here. The colors are the
// app's own (shared/theme.css).
export const THEME_CSS = `@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap");
${THEME}
:root { ${FONTS} }
html { background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
body { margin: 0; }
code, kbd, pre, samp { font-family: var(--font-mono); }`

/** The rules agents follow when they build an HTML plan. Shown on the Agents page and shipped in the skill. */
export const PLAN_AUTHORING_GUIDE = `Write one self-contained HTML document with inline <style> and <script>. Load libraries from a CDN (Chart.js, Mermaid, D3, KaTeX); they run as-is.
Drop shows the page full screen, so center a readable column (max-width ~760px) with its own padding.
Drop injects its theme as CSS custom properties on :root and follows the reader's light/dark mode: --background, --foreground, --muted, --muted-foreground, --card, --border, --primary, --primary-foreground, --destructive, --code-background, --chart-1 … --chart-8 (use in order), --positive, --caution, --negative, --radius, --font-sans, --font-mono. Use them instead of fixed colors. Grayscale first: color only for chart series and status.
Readers comment by selecting text, clicking images, or drawing a rectangle over any part of the page, so prefer real text, lists, and tables over text baked into images.
These are the same tokens T3 Code injects into HTML renders, so a page built for T3 looks the same here.`

/**
 * How a comment names an element of someone's page: a CSS path to it, a label (its tag and first words), and the
 * smallest element that holds a rectangle drawn over it. Shared by the frame's comment layer and the site review script.
 */
export const ELEMENT_NAMING = String.raw`function pathOf(el) {
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

  // A rectangle anchors to the smallest element that holds it, never the script's own root (skip).
  function anchorFor(left, top, right, bottom, skip) {
    const under = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).filter((el) => el !== skip && el !== document.documentElement);
    let best = null, bestArea = Infinity;
    for (const el of under) {
      const r = el.getBoundingClientRect(), area = r.width * r.height;
      if (r.width < 1 || r.height < 1 || r.left > left + 1 || r.top > top + 1 || r.right < right - 1 || r.bottom < bottom - 1) continue;
      if (area < bestArea) { best = el; bestArea = area; }
    }
    return best || under[0] || document.body;
  }`

/**
 * Comment layer. Runs inside the drop's frame, on another origin than Drop, so it only talks to Drop via postMessage.
 * Select text to comment on it; click an image to zoom and comment on a spot; in area mode (Drop's R), drag a rectangle.
 * Comark's own zoom, such as an annotated screenshot's, takes the same clicks and drags on its screenshots.
 * Commented text is highlighted with the CSS Custom Highlight API and everything else draws in a shadow root, so the
 * author's DOM is never modified.
 */
const ANNOTATOR_SCRIPT = String.raw`(() => {
  const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
  const host = document.createElement("drop-comments");
  host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  // --drop-z keeps pins their size on screen over a scaled-up zoom (see zoomLayer).
  const STYLE = '<style>' +
    '.m{position:absolute;scale:var(--drop-z,1);width:22px;height:22px;margin:-11px 0 0 -2px;overflow:hidden;border-radius:11px 11px 11px 2px;background:var(--primary);color:var(--primary-foreground);font:600 10px/22px var(--font-sans);letter-spacing:.02em;text-align:center;cursor:pointer;box-shadow:0 1px 4px rgb(0 0 0/.25),0 0 0 2px var(--background);transition:transform 120ms}' +
    '.m img{display:block;width:100%;height:100%;object-fit:cover}' +
    '.m:hover{transform:scale(1.15)}.m.done{opacity:.55;filter:grayscale(1)}.m.done:not(:has(img)){background:var(--muted-foreground)}.m.img{margin:-11px 0 0 -11px;border-radius:11px}' +
    '.m.pulse{animation:p 900ms ease-out 2}@keyframes p{50%{transform:scale(1.4)}}' +
    '.cp{position:absolute;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:var(--card);box-shadow:0 0 0 1px var(--border),0 1px 2px rgb(0 0 0/.06);color:var(--muted-foreground);cursor:pointer;opacity:0;transition:opacity 150ms ease-out,color 150ms ease-out}' +
    '.cp::before{content:"";position:absolute;inset:-6px}.cp svg{width:15px;height:15px}' +
    '.cp:hover,.cp:focus-visible,.cp.on{opacity:1}.cp:hover{color:var(--foreground)}@media (hover:none){.cp{opacity:1}}' +
    '.a{position:absolute;box-sizing:border-box;border:calc(1.5px * var(--drop-z,1)) solid var(--foreground);border-radius:3px;background:color-mix(in oklab,var(--foreground) 6%,transparent);pointer-events:none;transition:background 120ms}' +
    '.a.done{border-style:dashed;border-color:var(--muted-foreground);background:none;opacity:.6}.a.pulse{background:color-mix(in oklab,var(--foreground) 16%,transparent)}' +
    '.draw{position:fixed;inset:0;cursor:crosshair;touch-action:none}.draw .a{position:fixed}' +
    '</style>';
  const LAYERS = '<div class="marks"></div><div class="draft"></div>';
  shadow.innerHTML = STYLE + LAYERS;
  const marks = shadow.querySelector(".marks"), draft = shadow.querySelector(".draft");
  // Phosphor's copy and check, as in Drop's own buttons.
  const COPY_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M216 32H88a8 8 0 0 0-8 8v40H40a8 8 0 0 0-8 8v128a8 8 0 0 0 8 8h128a8 8 0 0 0 8-8v-40h40a8 8 0 0 0 8-8V40a8 8 0 0 0-8-8m-56 176H48V96h112Zm48-48h-32V88a8 8 0 0 0-8-8H96V48h112Z"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="m229.66 77.66l-128 128a8 8 0 0 1-11.32 0l-56-56a8 8 0 0 1 11.32-11.32L96 188.69L218.34 66.34a8 8 0 0 1 11.32 11.32"/></svg>';
  const pageStyle = document.createElement("style");
  pageStyle.textContent = "::highlight(drop-open){background:color-mix(in oklab,var(--foreground) 13%,transparent);text-decoration:underline;text-decoration-color:color-mix(in oklab,var(--foreground) 45%,transparent);text-underline-offset:3px}::highlight(drop-done){background:color-mix(in oklab,var(--foreground) 6%,transparent)}::highlight(drop-active){background:color-mix(in oklab,var(--foreground) 26%,transparent)}img{cursor:zoom-in}" +
    ".cz-dialog[data-drop-comment] .cz-item img{cursor:crosshair;touch-action:none}@media (max-width:40rem){[data-drop-hint]{display:none}}";
  let markers = [], active = null;
  const highlights = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";

  ${ELEMENT_NAMING}
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

  // Comark's zoom (comark-zoom) shows a copy of an item, such as an annotated screenshot, with a layer over the copy.
  // While it's open, comments draw and are written on the copy and anchor to the original on the page.
  let zoom = null, zoomHost = null, canComment = false;
  function zoomRoot() {
    // The copy sits inside an empty copy of the item's context, when the item names one the page has.
    const item = zoom.item, context = item.getAttribute("data-zoom-context");
    return context && item.parentElement && item.parentElement.closest(context) ? zoom.content.firstElementChild : zoom.content;
  }
  // The copy has the item's tree, so the same child positions lead from one to the other.
  function across(el, from, to) {
    if (!el || !from || !to || !from.contains(el)) return null;
    const path = [];
    for (let at = el; at !== from; at = at.parentElement) path.unshift(Array.prototype.indexOf.call(at.parentElement.children, at));
    let out = to;
    for (const index of path) out = out && out.children[index];
    return out || null;
  }
  const copyOf = (el) => (zoom ? across(el, zoom.item, zoomRoot()) : null);
  const originalOf = (el) => (zoom ? across(el, zoomRoot(), zoom.item) : null);
  // A shadow root in the zoom's layer. The layer scales with the copy, so pins and areas follow it as it zooms in and out.
  function zoomLayer() {
    if (!zoom || !zoom.layer || !zoom.layer.isConnected) return null;
    if (!zoomHost || zoomHost.parentElement !== zoom.layer) {
      zoomHost = document.createElement("drop-comments");
      zoomHost.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;";
      zoomHost.attachShadow({ mode: "open" }).innerHTML = STYLE + LAYERS;
      zoom.layer.appendChild(zoomHost);
    }
    const scale = parseFloat((/scale\(([\d.]+)\)/.exec(zoom.layer.parentElement.style.transform) || [])[1]) || 1;
    zoomHost.style.setProperty("--drop-z", String(1 / scale));
    return zoomHost.shadowRoot;
  }
  // A viewport rectangle in the layer's own pixels, before its scale.
  function inLayer(r) {
    const box = zoom.layer.getBoundingClientRect(), k = box.width / (zoom.layer.offsetWidth || 1) || 1;
    return { left: (r.left - box.left) / k, top: (r.top - box.top) / k, width: r.width / k, height: r.height / k };
  }
  function zoomDraft(left, top, right, bottom) {
    const layer = zoomLayer();
    if (!layer) return;
    const box = layer.querySelector(".draft");
    box.innerHTML = "";
    if (left === undefined) return;
    const b = inLayer({ left, top, width: right - left, height: bottom - top });
    areaBox(box, b.left, b.top, b.width, b.height);
  }
  // The zoomed screenshot under a point: comments in the zoom are on images, like the ones Drop's own lightbox takes.
  function shotAt(x, y) {
    if (!zoom) return null;
    return Array.from(zoom.content.querySelectorAll("img")).find((img) => {
      const r = img.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) || null;
  }
  const thousandths = (value, start, size) => Math.min(1000, Math.max(0, Math.round(((value - start) / (size || 1)) * 1000)));
  function commentOnShot(shot, left, top, right, bottom) {
    const img = originalOf(shot);
    if (!img) return;
    const r = shot.getBoundingClientRect();
    [left, right] = [left, right].map((x) => Math.min(r.right, Math.max(r.left, x)));
    [top, bottom] = [top, bottom].map((y) => Math.min(r.bottom, Math.max(r.top, y)));
    const ox = thousandths(left, r.left, r.width), oy = thousandths(top, r.top, r.height);
    if (right > left || bottom > top) zoomDraft(left, top, right, bottom); else zoomDraft();
    post({ type: "area", kind: "image", selector: pathOf(img), label: img.getAttribute("alt") || "image", ox, oy, ow: thousandths(right, r.left, r.width) - ox, oh: thousandths(bottom, r.top, r.height) - oy, rect: { left, top, right, bottom } });
  }
  // A hint in the zoom's header and a crosshair over its screenshots, while the reader can comment.
  function markZoom() {
    if (!zoom) return;
    const on = canComment && Boolean(zoom.content.querySelector("img"));
    zoom.dialog.toggleAttribute("data-drop-comment", on);
    const close = zoom.header.querySelector(".cz-close");
    let hint = zoom.header.querySelector("[data-drop-hint]");
    if (on && !hint) {
      hint = document.createElement("span");
      hint.setAttribute("data-drop-hint", "");
      hint.textContent = "Click a spot or drag an area to comment";
      hint.style.cssText = "margin-left:auto;color:var(--cz-muted);font-size:12px;white-space:nowrap";
      zoom.header.insertBefore(hint, close);
    }
    if (!on && hint) hint.remove();
    if (close) close.style.marginLeft = on ? ".5rem" : "";
  }

  /**
   * Whether an element still is what a comment from an earlier version pointed at. The selector is a position in the
   * page, so it also matches whatever took that place; the label (tag and first words, or the image's alt) tells.
   */
  function sameAnchor(el, m) {
    if (!m.label) return true;
    return m.kind === "image" ? (el.getAttribute("alt") || "image") === m.label : labelOf(el) === m.label;
  }

  const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "?";
  let lastUnplaced = null;
  function render() {
    marks.innerHTML = "";
    const layer = zoom && zoomLayer(), zoomMarks = layer && layer.querySelector(".marks");
    if (zoomMarks) zoomMarks.innerHTML = "";
    const open = [], done = [], act = [], unplaced = [];
    for (const m of markers) {
      let x, y, into = marks;
      if (m.kind === "image" || m.kind === "area") {
        // Placed from the anchor's current box, so areas and pins follow reflow.
        const el = query(m.selector);
        if (!el || (m.earlier && !sameAnchor(el, m))) { unplaced.push(m.id); continue; }
        resized.observe(el);
        const r = el.getBoundingClientRect();
        // A hidden anchor (a closed tab, a prototype variant not shown) draws nothing until it shows again.
        if (!r.width && !r.height) continue;
        // While zoomed, only what the zoom shows draws, on its copy: the page's pins would float over the zoom.
        const copy = zoom && zoomMarks && copyOf(el);
        if (zoom && !copy) continue;
        const b = copy ? inLayer(copy.getBoundingClientRect()) : { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height };
        if (copy) into = zoomMarks;
        x = b.left + (m.ox / 1000) * b.width; y = b.top + (m.oy / 1000) * b.height;
        if (m.ow || m.oh) areaBox(into, x, y, (m.ow / 1000) * b.width, (m.oh / 1000) * b.height, (m.resolved ? " done" : "") + (m.id === active ? " pulse" : ""));
      } else {
        // The quote is searched in its block first, then the whole page, so text that moved keeps its comment.
        const range = m.quote ? findRange(m.selector, m.quote) : null;
        if (!range) { unplaced.push(m.id); continue; }
        (m.id === active ? act : m.resolved ? done : open).push(range);
        if (zoom) continue;
        const rects = range.getClientRects(), last = rects[rects.length - 1];
        if (!last) continue;
        x = last.right + scrollX + 2; y = last.top + scrollY;
      }
      const dot = document.createElement("div");
      dot.className = "m" + (m.kind !== "text" ? " img" : "") + (m.resolved ? " done" : "") + (m.id === active ? " pulse" : "");
      // The author's picture, else their initials; the panel and the agent feedback keep the number.
      if (m.image) { const img = document.createElement("img"); img.src = m.image; img.alt = ""; img.referrerPolicy = "no-referrer"; img.onerror = () => { img.remove(); dot.textContent = initials(m.author); }; dot.appendChild(img); }
      else dot.textContent = initials(m.author);
      dot.title = (m.author || "Comment") + " · #" + m.n;
      dot.style.left = x + "px"; dot.style.top = y + "px"; dot.dataset.id = m.id;
      dot.onclick = (e) => { e.stopPropagation(); const r = dot.getBoundingClientRect(); post({ type: "marker", id: m.id, clientX: r.right, clientY: r.top }); };
      into.appendChild(dot);
    }
    // A copy button on each code block, shown while the pointer is over it: the block scrolls sideways under it, so an
    // always-on label would sit on top of the code. The sandbox has no clipboard access, so Drop copies.
    if (!zoom) document.querySelectorAll("pre:not(.mermaid)").forEach((pre) => {
      const r = pre.getBoundingClientRect();
      if (r.height < 24) return;
      const chip = document.createElement("button");
      chip.className = "cp";
      chip.setAttribute("aria-label", "Copy code");
      chip.title = "Copy code";
      chip.innerHTML = COPY_ICON;
      marks.appendChild(chip);
      chip.style.left = r.right + scrollX - chip.offsetWidth - 6 + "px";
      chip.style.top = r.top + scrollY + 6 + "px";
      // Assigned, not added: this runs again on every resize and must not stack listeners.
      pre.onmouseenter = () => chip.classList.add("on");
      pre.onmouseleave = () => chip.classList.remove("on");
      if (pre.matches(":hover")) chip.classList.add("on");
      chip.onclick = (e) => {
        e.stopPropagation();
        post({ type: "copy", text: pre.innerText });
        chip.innerHTML = CHECK_ICON;
        chip.setAttribute("aria-label", "Copied");
        setTimeout(() => { chip.innerHTML = COPY_ICON; chip.setAttribute("aria-label", "Copy code"); }, 1400);
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
    const target = e.target && e.target.closest ? e.target : null;
    // Comark zooms its own blocks, such as annotated screenshots: its view keeps their marks and notes and pages
    // through a comparison, which Drop's lightbox of the bare image can't. The area tool still comments on them.
    const zoomed = target && target.closest("[data-zoom], .cz-dialog");
    const img = !zoomed && target && target.closest("img");
    // A srcdoc document resolves "#id" against Drop's page, so the frame would load Drop and be refused. Scroll here.
    const link = !img && location.protocol === "about:" && target && target.closest('a[href^="#"]');
    if (link && !host.contains(link)) {
      e.preventDefault();
      const id = decodeURIComponent(link.getAttribute("href").slice(1));
      const to = id && document.getElementById(id);
      if (to) to.scrollIntoView({ block: "start" }); else if (!id) scrollTo(0, 0);
      return;
    }
    if (!img || host.contains(img) || (getSelection() && !getSelection().isCollapsed)) return;
    e.preventDefault(); e.stopPropagation();
    // The viewport rect lets Drop zoom the image out of the page instead of popping it open.
    const r = img.getBoundingClientRect();
    post({ type: "image", src: img.currentSrc || img.src, alt: img.alt || "", selector: pathOf(img), label: labelOf(img), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  }, true);

  // Area mode: a crosshair layer over the page. Drag a rectangle; it anchors to the smallest element that holds it.
  let drawing = null;
  function finishArea(left, top, right, bottom) {
    // Over the zoom, an area is on the screenshot under it; anything else there is a copy and can't take a comment.
    if (zoom) {
      const shot = shotAt((left + right) / 2, (top + bottom) / 2);
      if (shot) commentOnShot(shot, left, top, right, bottom);
      return;
    }
    const el = anchorFor(left, top, right, bottom, host), r = el.getBoundingClientRect();
    const ox = thousandths(left, r.left, r.width), oy = thousandths(top, r.top, r.height);
    // Keep the drawn rectangle on the page while the comment is written; Drop clears it.
    draft.innerHTML = "";
    areaBox(draft, left + scrollX, top + scrollY, right - left, bottom - top);
    post({ type: "area", selector: pathOf(el), label: labelOf(el), ox, oy, ow: thousandths(right, r.left, r.width) - ox, oh: thousandths(bottom, r.top, r.height) - oy, rect: { left, top, right, bottom } });
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

  // In the zoom, a click on a screenshot comments on that spot and a drag on an area of it, as in Drop's lightbox.
  let pressed = null;
  document.addEventListener("pointerdown", (e) => {
    if (!zoom || !canComment || drawing || e.button !== 0 || !zoom.content.contains(e.target) || e.target.closest("a,button")) return;
    const shot = shotAt(e.clientX, e.clientY);
    if (!shot) return;
    // No text selection or image drag: the press is a comment.
    e.preventDefault();
    pressed = { x: e.clientX, y: e.clientY, shot, moved: false };
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (!pressed) return;
    if (!pressed.moved && Math.max(Math.abs(e.clientX - pressed.x), Math.abs(e.clientY - pressed.y)) < 6) return;
    pressed.moved = true;
    zoomDraft(Math.min(pressed.x, e.clientX), Math.min(pressed.y, e.clientY), Math.max(pressed.x, e.clientX), Math.max(pressed.y, e.clientY));
  });
  document.addEventListener("pointerup", (e) => {
    if (!pressed) return;
    const p = pressed;
    pressed = null;
    if (!zoom) return;
    if (p.moved) commentOnShot(p.shot, Math.min(p.x, e.clientX), Math.min(p.y, e.clientY), Math.max(p.x, e.clientX), Math.max(p.y, e.clientY));
    else commentOnShot(p.shot, p.x, p.y, p.x, p.y);
  });
  document.addEventListener("pointercancel", () => { if (pressed) { pressed = null; zoomDraft(); } });
  const onZoom = (e) => {
    zoom = e.detail && e.detail.layer && e.detail.content && e.detail.item ? e.detail : null;
    pressed = null;
    markZoom();
    render();
  };
  document.addEventListener("comark-zoom:open", onZoom);
  document.addEventListener("comark-zoom:change", onZoom);
  document.addEventListener("comark-zoom:close", () => { zoom = zoomHost = pressed = null; render(); });

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent) return;
    if (m.type === "markers") { markers = m.markers; render(); }
    if (m.type === "clear-selection") { getSelection().removeAllRanges(); lastQuote = ""; draft.innerHTML = ""; zoomDraft(); }
    if (m.type === "area-mode") setAreaMode(Boolean(m.on));
    if (m.type === "clear-area") { draft.innerHTML = ""; zoomDraft(); }
    // Whether the reader may comment, so the zoom only takes clicks as comments when they can.
    if (m.type === "commenting") { canComment = Boolean(m.on); markZoom(); }
    // How much of the right edge Drop's floating panel covers. Drop's own documents read it to stay clear.
    if (m.type === "inset") { document.documentElement.style.setProperty("--drop-inset", (Number(m.right) || 0) + "px"); render(); }
    if (m.type === "focus") {
      active = m.id; render();
      const dot = Array.from(marks.children).find((d) => d.classList.contains("pulse"));
      if (dot) scrollTo({ top: Math.max(0, parseFloat(dot.style.top) - innerHeight / 3), behavior: "smooth" });
      // With open: once the scroll settles, report the pin like a click, so Drop opens its thread beside it.
      if (dot && m.open) setTimeout(() => {
        const pin = Array.from(marks.children).find((d) => d.dataset.id === m.id);
        if (pin) { const r = pin.getBoundingClientRect(); post({ type: "marker", id: m.id, clientX: r.right, clientY: r.top }); }
      }, 500);
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
})();`

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
})();`

/**
 * Reports the page's own failures to Drop so the agent that published it can read them: uncaught errors, rejected
 * promises nobody handled, console.error calls, and files that failed to load. Runs before the page's scripts.
 * At most 20 distinct reports per page load, each cut to 500 characters.
 */
const ERROR_REPORTER = String.raw`(() => {
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
})();`

/** Puts `snippet` first in the head, or after the doctype when there's no head tag, so the page keeps standards mode. */
export function prependToHead(html: string, snippet: string): string {
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (match) => match + snippet)
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? ""
  return doctype + snippet + html.slice(doctype.length)
}

/** `inset`: the room the viewer's floating panel takes on the right at load, so the text starts clear of it. */
export function injectRuntime(html: string, dark: boolean, inset = 0): string {
  const head = `<script>${ERROR_REPORTER}</script><script>${OPAQUE_ORIGIN_SHIM}</script><style data-drop-theme>${THEME_CSS}</style><script>document.documentElement.classList.toggle("dark", ${dark});document.documentElement.style.setProperty("--drop-inset", "${inset || 0}px");</script>`
  const tail = `<script>${ANNOTATOR_SCRIPT}</script>`
  let out = prependToHead(html, head)
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, tail + "</body>") : out + tail
  return out
}
