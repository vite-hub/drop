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
When the page reads them, Drop injects its theme as CSS custom properties on :root and follows the reader's light/dark mode: --background, --foreground, --muted, --muted-foreground, --card, --border, --primary, --primary-foreground, --destructive, --code-background, --chart-1 … --chart-8 (use in order), --positive, --caution, --negative, --radius, --font-sans, --font-mono. Use them instead of fixed colors. Grayscale first: color only for chart series and status.
Readers comment by selecting text, or with the Comment tool by clicking an element or drawing a rectangle over any part of the page; clicks stay your page's own. Prefer real text, lists, and tables over text baked into images.
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
 * Select text to comment on it; click an image to zoom and comment on a spot. The viewer's toolbar picks a tool: with
 * Comment (R), click an element to pin a comment to it or drag a rectangle; with Measure, inspect sizes and distances.
 * On a page someone else built (an HTML doc or an app, AUTHORED), clicks stay the page's own: no image zoom, no copy
 * buttons on its code. Its images take comments through the Comment tool.
 * Comark's own zoom, such as an annotated screenshot's, shows the comments on what it zooms and takes areas drawn on it.
 * Commented text is highlighted with the CSS Custom Highlight API and everything else draws in a shadow root, so the
 * author's DOM is never modified.
 */
const ANNOTATOR_SCRIPT = String.raw`(() => {
  const AUTHORED = __AUTHORED__, THEMED = __THEMED__, DARK = __DARK__;
  const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
  const host = document.createElement("drop-comments");
  host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  // --drop-z keeps pins their size on screen over a scaled-up zoom (see zoomLayer).
  // A page without Drop's theme may lack its tokens, or hold its own under the same names: pins keep Drop's neutrals.
  const STYLE = '<style>' + (THEMED ? '' : ':host{--primary:#171717;--primary-foreground:#fafafa;--background:#fff;--foreground:#0a0a0a;--muted-foreground:#737373;--card:#fff;--border:#e5e5e5;--font-sans:ui-sans-serif,system-ui,sans-serif}') +
    '.m{position:absolute;z-index:2;scale:var(--drop-z,1);width:22px;height:22px;margin:-11px 0 0 -2px;overflow:hidden;border-radius:11px 11px 11px 2px;background:var(--primary);color:var(--primary-foreground);font:600 10px/22px var(--font-sans);letter-spacing:.02em;text-align:center;cursor:pointer;box-shadow:0 1px 4px rgb(0 0 0/.25),0 0 0 2px var(--background);transition:transform 120ms}' +
    '.m img{display:block;width:100%;height:100%;object-fit:cover}' +
    '.m:hover{transform:scale(1.15)}.m.done{opacity:.55;filter:grayscale(1)}.m.done:not(:has(img)){background:var(--muted-foreground)}.m.img{margin:-11px 0 0 -11px;border-radius:11px}' +
    '.m.pulse{animation:p 900ms ease-out 2}@keyframes p{50%{transform:scale(1.4)}}' +
    '.cp{position:absolute;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:var(--card);box-shadow:0 0 0 1px var(--border),0 1px 2px rgb(0 0 0/.06);color:var(--muted-foreground);cursor:pointer;opacity:0;transition:opacity 150ms ease-out,color 150ms ease-out}' +
    '.cp::before{content:"";position:absolute;inset:-6px}.cp svg{width:15px;height:15px}' +
    '.cp:hover,.cp:focus-visible,.cp.on{opacity:1}.cp:hover{color:var(--foreground)}@media (hover:none){.cp{opacity:1}}' +
    '.a{position:absolute;box-sizing:border-box;border:calc(1.5px * var(--drop-z,1)) solid var(--foreground);border-radius:3px;background:color-mix(in oklab,var(--foreground) 6%,transparent);pointer-events:none;transition:background 120ms}' +
    '.a.done{border-style:dashed;border-color:var(--muted-foreground);background:none;opacity:.6}.a.pulse{background:color-mix(in oklab,var(--foreground) 16%,transparent)}' +
    '.draw{position:fixed;inset:0;cursor:crosshair;touch-action:none}.draw .a{position:fixed}.draw.measure{cursor:default}' +
    '.dp{position:absolute;scale:var(--drop-z,1);width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--hi);box-shadow:0 0 0 2px #fff,0 1px 4px rgb(0 0 0/.3);pointer-events:none}' +
    // The tools' drawings (setTool below), in Mesurer's look: its highlight and guide hues for lines, the same hues darker
    // (4.7:1 under white) behind labels, its white card and rulers in light mode and their dark cut in dark, and the box
    // model in DevTools' colors.
    ':host{--hi:oklch(0.62 0.18 255);--hi-fill:oklch(0.56 0.18 255);--gd:oklch(0.63 0.26 29.23);--gd-fill:oklch(0.58 0.22 29.23);' +
    (DARK ? '--sf:#18181b;--ink:#fafafa;--ink-muted:#a1a1aa;--tick:#52525b;--float:0 0 0 .5px rgb(255 255 255/.16),0 1px 1px rgb(0 0 0/.125),0 2px 5px rgb(0 0 0/.125),0 3px 8px rgb(0 0 0/.125)}'
      : '--sf:#fff;--ink:#18181b;--ink-muted:#71717a;--tick:#cbd5e1;--float:0 0 0 .5px rgb(0 0 0/.18),0 1px 1px rgb(0 0 0/.06),0 3px 9px rgb(0 0 0/.06),0 6px 18px rgb(0 0 0/.03)}') +
    '.fx>*{position:fixed;box-sizing:border-box;pointer-events:none}.hl{outline:1.5px solid var(--hi);outline-offset:-.75px}.hl.sel{outline-width:2px;background:color-mix(in oklab,var(--hi) 8%,transparent)}' +
    '.mb{background:rgb(246 178 107/.35)}.pb{background:rgb(147 196 125/.4)}.ln{background:var(--gd)}.ln.dash{background:none;border:0 dashed var(--gd)}' +
    '.tag{padding:2px 4px;border-radius:4px;background:var(--hi-fill);color:#fff;font:500 10px/14px ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}.tag.d{background:var(--gd-fill)}' +
    '.card{width:15rem;box-sizing:border-box;padding:8px;border:1px solid transparent;border-radius:8px;background:var(--sf);color:var(--ink);font:11px/16px ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;box-shadow:var(--float)}' +
    '.card b{display:block;margin-bottom:6px;font:500 11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.card div{display:flex;justify-content:space-between;gap:12px}.card span:first-child{color:var(--ink-muted)}.card span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sw{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:3px;vertical-align:-1px;box-shadow:inset 0 0 0 1px rgb(128 128 128/.35)}' +
    '.ru{position:fixed;z-index:1;display:block;background:var(--sf);box-shadow:0 0 0 .5px rgb(128 128 128/.35)}.ru.x{left:18px;top:0;cursor:row-resize}.ru.y{left:0;top:18px;cursor:col-resize}.ru.c{left:0;top:0;width:18px;height:18px;cursor:default}' +
    '.gd{position:absolute;background:var(--gd)}.gd::before{content:"";position:absolute;inset:-3px}.gd.h{height:1px;left:0}.gd.h::before{cursor:row-resize}.gd.v{width:1px;top:0}.gd.v::before{cursor:col-resize}' +
    '</style>';
  const LAYERS = '<div class="marks"></div><div class="draft"></div>';
  shadow.innerHTML = STYLE + LAYERS;
  const marks = shadow.querySelector(".marks"), draft = shadow.querySelector(".draft");
  // MingCute's copy and check, at the 1.75 stroke of Drop's own buttons (app.config icon.customize).
  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.75" d="M8 6V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2M4 21h11a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1Z"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m3.514 11.83l5.657 5.656L20.485 6.172"/></svg>';
  const pageStyle = document.createElement("style");
  pageStyle.textContent = "::highlight(drop-open){background:color-mix(in oklab,var(--foreground) 13%,transparent);text-decoration:underline;text-decoration-color:color-mix(in oklab,var(--foreground) 45%,transparent);text-underline-offset:3px}::highlight(drop-done){background:color-mix(in oklab,var(--foreground) 6%,transparent)}::highlight(drop-active){background:color-mix(in oklab,var(--foreground) 26%,transparent)}" + (AUTHORED ? "" : "img{cursor:zoom-in}");
  // Highlights draw on the page itself, so without Drop's theme they take a grey that shows on light and dark pages.
  if (!THEMED) pageStyle.textContent = pageStyle.textContent.replaceAll("var(--foreground)", "#808080");
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
  // While it's open, comments draw and are written on the copy and anchor to the original on the page; the zoom maps its
  // copies (the item's, and its notes beside it) to the page and back.
  let zoom = null;
  const copyOf = (el) => (zoom && el ? zoom.copyOf(el) : null);
  const originalOf = (el) => (zoom && el ? zoom.originalOf(el) : null);
  // A shadow root in the zoom: in its layer, which scales with the copy, so pins and areas follow it as it zooms in and
  // out; or in its aside, the notes beside the copy, which would cover the layer's pins there and doesn't scale.
  function zoomShadow(box) {
    if (!zoom || !box || !box.isConnected) return null;
    let host = Array.from(box.children).find((el) => el.localName === "drop-comments");
    if (!host) {
      host = document.createElement("drop-comments");
      host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;";
      host.attachShadow({ mode: "open" }).innerHTML = STYLE + LAYERS;
      box.appendChild(host);
    }
    if (box === zoom.layer) {
      const scale = parseFloat((/scale\(([\d.]+)\)/.exec(box.parentElement.style.transform) || [])[1]) || 1;
      host.style.setProperty("--drop-z", String(1 / scale));
    }
    return host.shadowRoot;
  }
  const zoomLayer = () => zoom && zoomShadow(zoom.layer);
  const zoomAside = () => zoom && zoom.aside && zoomShadow(zoom.aside);
  // A viewport rectangle in the layer's own pixels, before its scale.
  function inLayer(r) {
    const box = zoom.layer.getBoundingClientRect(), k = box.width / (zoom.layer.offsetWidth || 1) || 1;
    return { left: (r.left - box.left) / k, top: (r.top - box.top) / k, width: r.width / k, height: r.height / k };
  }
  // A viewport rectangle in the aside's pixels, which scroll with its notes.
  function inAside(r) {
    const aside = zoom.aside, box = aside.getBoundingClientRect();
    return { left: r.left - box.left + aside.scrollLeft, top: r.top - box.top + aside.scrollTop, width: r.width, height: r.height };
  }
  function overAside(x, y) {
    const box = zoom && zoom.aside && zoom.aside.getBoundingClientRect();
    return Boolean(box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
  }
  function zoomDraft(left, top, right, bottom) {
    const layer = zoomLayer(), aside = zoomAside();
    for (const root of [layer, aside]) if (root) root.querySelector(".draft").innerHTML = "";
    if (left === undefined) return;
    const r = { left, top, width: right - left, height: bottom - top };
    const beside = aside && overAside((left + right) / 2, (top + bottom) / 2);
    const b = beside ? inAside(r) : inLayer(r), root = beside ? aside : layer;
    if (root) areaBox(root.querySelector(".draft"), b.left, b.top, b.width, b.height);
  }
  // The zoomed screenshot under a point: an area drawn on it is a comment on the image, like the ones Drop's lightbox takes.
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
    const aside = zoomMarks && zoomAside(), asideMarks = aside && aside.querySelector(".marks");
    if (zoomMarks) zoomMarks.innerHTML = "";
    if (asideMarks) asideMarks.innerHTML = "";
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
        const beside = copy && asideMarks && zoom.aside.contains(copy);
        const b = !copy ? { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height } : beside ? inAside(copy.getBoundingClientRect()) : inLayer(copy.getBoundingClientRect());
        if (copy) into = beside ? asideMarks : zoomMarks;
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
    if (!zoom && !AUTHORED) document.querySelectorAll("pre:not(.mermaid)").forEach((pre) => {
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
    // Hidden comments (the toolbar's eye) keep their place, so showing them again needs no new render.
    marks.style.display = view.pins ? "" : "none";
    if (highlights) {
      const show = (ranges) => new Highlight(...(view.pins ? ranges : []));
      CSS.highlights.set("drop-open", show(open));
      CSS.highlights.set("drop-done", show(done));
      CSS.highlights.set("drop-active", show(act));
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
    const img = !AUTHORED && !zoomed && target && target.closest("img");
    // A srcdoc document resolves "#id" against Drop's page, so the frame would load Drop and be refused. Scroll here.
    const link = !img && location.protocol === "about:" && target && target.closest('a[href^="#"]');
    if (link && !host.contains(link)) {
      e.preventDefault();
      const id = decodeURIComponent(link.getAttribute("href").slice(1));
      const to = id && document.getElementById(id);
      if (to) to.scrollIntoView({ block: "start" }); else if (!id) scrollTo(0, 0);
      return;
    }
    // A link to another site would load it inside the frame, where most sites (GitHub among them) refuse to show.
    const away = !img && target && target.closest("a[href]");
    if (away && !host.contains(away) && !away.target && /^https?:$/.test(away.protocol) && away.origin !== location.origin) {
      away.target = "_blank";
      away.relList.add("noopener");
      return;
    }
    // An image still on its way (data-drop-image) has nothing to zoom yet.
    if (!img || img.dataset.dropImage || host.contains(img) || (getSelection() && !getSelection().isCollapsed)) return;
    e.preventDefault(); e.stopPropagation();
    // The viewport rect lets Drop zoom the image out of the page instead of popping it open.
    const r = img.getBoundingClientRect();
    post({ type: "image", src: img.currentSrc || img.src, alt: img.alt || "", selector: pathOf(img), label: labelOf(img), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  }, true);

  /**
   * Comment and measure tools: a layer over the page takes the pointer, so its clicks and hovers don't reach the page.
   * Comment outlines the element under the pointer; a click pins a comment to that spot of it, a drag draws an area.
   * Measure shows the element's size and box model, its type and colors, and, once one is picked, the distances from
   * it to whatever the pointer is over.
   */
  let tool = "browse", layer = null, hovered = null, picked = null;
  const view = { rulers: false, xray: false, pins: true };
  const fx = document.createElement("div");
  fx.className = "fx";
  function finishArea(left, top, right, bottom) {
    // Over the zoom, an area on a screenshot is on that image; anywhere else it anchors to the original of the copy under it.
    const shot = zoom && shotAt((left + right) / 2, (top + bottom) / 2);
    if (shot) return commentOnShot(shot, left, top, right, bottom);
    const under = anchorFor(left, top, right, bottom, host), el = zoom ? originalOf(under) : under;
    if (!el) return;
    const r = under.getBoundingClientRect();
    const ox = thousandths(left, r.left, r.width), oy = thousandths(top, r.top, r.height);
    // Keep the drawn rectangle, or the clicked spot, on the page or the zoom while the comment is written; Drop clears it.
    draft.innerHTML = "";
    if (zoom) zoomDraft(left, top, right, bottom);
    else if (right > left) areaBox(draft, left + scrollX, top + scrollY, right - left, bottom - top);
    else { const dot = document.createElement("div"); dot.className = "dp"; dot.style.cssText = "left:" + (left + scrollX) + "px;top:" + (top + scrollY) + "px"; draft.appendChild(dot); }
    const ow = right > left ? thousandths(right, r.left, r.width) - ox : 0, oh = right > left ? thousandths(bottom, r.top, r.height) - oy : 0;
    post({ type: "area", selector: pathOf(el), label: labelOf(under), ox, oy, ow, oh, rect: { left, top, right, bottom } });
  }

  // The element under a point, past Drop's own layer.
  function elementAt(x, y) {
    return document.elementsFromPoint(x, y).find((el) => el !== host && el !== document.documentElement) || document.body;
  }
  const px = (n) => String(Math.round(n * 10) / 10);
  const num = (value) => parseFloat(value) || 0;
  function nameOf(el) {
    const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + classes.map((c) => "." + c).join("");
  }
  function hex(color) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color);
    if (!m) return color;
    const out = "#" + [m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("");
    return m[4] !== undefined && m[4] !== "1" ? out + " " + Math.round(Number(m[4]) * 100) + "%" : out;
  }
  const clear = (color) => !color || color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);

  function fixedBox(className, left, top, width, height) {
    const el = document.createElement("div");
    el.className = className;
    el.style.cssText = "left:" + left + "px;top:" + top + "px;width:" + Math.max(0, width) + "px;height:" + Math.max(0, height) + "px";
    fx.appendChild(el);
    return el;
  }
  // A label kept on screen; with center, centered on x.
  function tag(text, x, y, className, center) {
    const el = document.createElement("div");
    el.className = "tag" + (className ? " " + className : "");
    el.textContent = text;
    fx.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(2, Math.min(innerWidth - w - 2, center ? x - w / 2 : x)) + "px";
    el.style.top = Math.max(2, Math.min(innerHeight - h - 2, y)) + "px";
    return el;
  }
  function outline(el, strong) {
    const r = el.getBoundingClientRect();
    fixedBox("hl" + (strong ? " sel" : ""), r.left, r.top, r.width, r.height);
    return r;
  }
  // Margin outside the border box, padding inside it, as DevTools colors them.
  function boxModel(el) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    const m = [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft].map((v) => Math.max(0, num(v)));
    const b = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(num);
    const p = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(num);
    fixedBox("mb", r.left - m[3], r.top - m[0], r.width + m[1] + m[3], m[0]);
    fixedBox("mb", r.left - m[3], r.bottom, r.width + m[1] + m[3], m[2]);
    fixedBox("mb", r.left - m[3], r.top, m[3], r.height);
    fixedBox("mb", r.right, r.top, m[1], r.height);
    const inner = { left: r.left + b[3], top: r.top + b[0], right: r.right - b[1], bottom: r.bottom - b[2] };
    fixedBox("pb", inner.left, inner.top, inner.right - inner.left, p[0]);
    fixedBox("pb", inner.left, inner.bottom - p[2], inner.right - inner.left, p[2]);
    fixedBox("pb", inner.left, inner.top + p[0], p[3], inner.bottom - inner.top - p[0] - p[2]);
    fixedBox("pb", inner.right - p[1], inner.top + p[0], p[1], inner.bottom - inner.top - p[0] - p[2]);
  }
  function hLine(y, x1, x2) {
    if (x2 - x1 < 0.5) return;
    fixedBox("ln", x1, y, x2 - x1, 1);
    tag(px(x2 - x1), (x1 + x2) / 2, y + 4, "d", true);
  }
  function vLine(x, y1, y2) {
    if (y2 - y1 < 0.5) return;
    fixedBox("ln", x, y1, 1, y2 - y1);
    tag(px(y2 - y1), x + 5, (y1 + y2) / 2 - 9, "d");
  }
  // Figma's way: the gaps between two boxes side by side, or from a box to the one that holds it.
  function distances(a, b) {
    const holds = (o, i) => i.left >= o.left && i.right <= o.right && i.top >= o.top && i.bottom <= o.bottom;
    if (holds(a, b) || holds(b, a)) {
      const [o, i] = holds(a, b) ? [a, b] : [b, a];
      const cx = i.left + i.width / 2, cy = i.top + i.height / 2;
      vLine(cx, o.top, i.top); vLine(cx, i.bottom, o.bottom); hLine(cy, o.left, i.left); hLine(cy, i.right, o.right);
      return;
    }
    const apartX = b.left >= a.right || a.left >= b.right, apartY = b.top >= a.bottom || a.top >= b.bottom;
    if (apartX) {
      const [l, r] = b.left >= a.right ? [a, b] : [b, a];
      const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
      hLine(top < bottom ? (top + bottom) / 2 : a.top + a.height / 2, l.right, r.left);
    }
    if (apartY) {
      const [t, u] = b.top >= a.bottom ? [a, b] : [b, a];
      const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
      vLine(left < right ? (left + right) / 2 : a.left + a.width / 2, t.bottom, u.top);
    }
    // Overlapping without one holding the other: how far their left and top edges are apart.
    if (!apartX && !apartY) {
      hLine(Math.max(a.top, b.top) + 4, Math.min(a.left, b.left), Math.max(a.left, b.left));
      vLine(Math.max(a.left, b.left) + 4, Math.min(a.top, b.top), Math.max(a.top, b.top));
    }
  }
  // What a designer asks about an element: its size, type, colors, spacing, and corners.
  function infoCard(el) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    const rows = [["Size", px(r.width) + " × " + px(r.height)]];
    const sides = (values) => { const v = values.map((x) => px(num(x))); return v.every((x) => x === v[0]) ? v[0] : v[0] === v[2] && v[1] === v[3] ? v[0] + " " + v[1] : v.join(" "); };
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.data.trim());
    if (own || !el.children.length) {
      rows.push(["Font", s.fontFamily.split(",")[0].replace(/["']/g, "").trim()]);
      rows.push(["Type", px(num(s.fontSize)) + (s.lineHeight === "normal" ? "" : " / " + px(num(s.lineHeight))) + " · " + s.fontWeight]);
      rows.push(["Color", s.color]);
    }
    if (!clear(s.backgroundColor)) rows.push(["Fill", s.backgroundColor]);
    const padding = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft];
    if (padding.some(num)) rows.push(["Padding", sides(padding)]);
    const margin = [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft];
    if (margin.some(num)) rows.push(["Margin", sides(margin)]);
    if (/flex|grid/.test(s.display) && s.gap && s.gap !== "normal" && num(s.gap)) rows.push(["Gap", s.gap.split(" ").map((g) => px(num(g))).join(" ")]);
    const radius = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius];
    if (radius.some(num)) rows.push(["Radius", sides(radius)]);
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("b");
    title.textContent = nameOf(el);
    card.appendChild(title);
    for (const [key, value] of rows) {
      const row = document.createElement("div"), k = document.createElement("span"), v = document.createElement("span");
      k.textContent = key;
      if (key === "Color" || key === "Fill") { const sw = document.createElement("i"); sw.className = "sw"; sw.style.background = value; v.appendChild(sw); v.appendChild(document.createTextNode(hex(value))); }
      else v.textContent = value;
      row.append(k, v);
      card.appendChild(row);
    }
    fx.appendChild(card);
    // Below the element, else above it, else in the bottom corner, always on screen.
    const w = card.offsetWidth, h = card.offsetHeight, gap = 10;
    const top = r.bottom + gap + h < innerHeight ? r.bottom + gap : r.top - gap - h > 0 ? r.top - gap - h : innerHeight - h - 12;
    card.style.left = Math.max(view.rulers ? RULER + 8 : 8, Math.min(innerWidth - w - 8, r.left)) + "px";
    card.style.top = Math.max(view.rulers ? RULER + 8 : 8, top) + "px";
  }

  let toolFrame = 0;
  function drawTools() {
    toolFrame = 0;
    fx.innerHTML = "";
    if (hovered && !hovered.isConnected) hovered = null;
    if (picked && !picked.isConnected) picked = null;
    if (tool === "comment" && hovered && !(layer && layer.dragging)) {
      const r = outline(hovered);
      tag(nameOf(hovered) + "  " + px(r.width) + " × " + px(r.height), r.left, r.top - 22 < (view.rulers ? 20 : 0) ? r.bottom + 4 : r.top - 22);
    }
    if (tool === "measure") {
      const over = hovered && hovered !== picked ? hovered : null;
      if (picked) boxModel(picked);
      else if (over) boxModel(over);
      const a = picked && outline(picked, true), b = over && outline(over);
      if (a && b) distances(a, b);
      const sized = a || b;
      if (sized && !(a && b)) tag(px(sized.width) + " × " + px(sized.height), sized.left + sized.width / 2, sized.bottom + 6, "", true);
      if (picked || over) infoCard(picked || over);
    }
    drawRulers();
  }
  const redraw = () => { if (!toolFrame) toolFrame = requestAnimationFrame(drawTools); };

  function setTool(next) {
    if (next === tool) return;
    tool = next;
    hovered = picked = null;
    if (layer) { layer.remove(); layer = null; }
    if (tool !== "browse") {
      getSelection().removeAllRanges();
      if (lastQuote) post({ type: "selection", clear: true });
      lastQuote = "";
      layer = document.createElement("div");
      layer.className = "draw" + (tool === "measure" ? " measure" : "");
      let start = null, box = null;
      layer.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        layer.setPointerCapture(e.pointerId);
        start = { x: e.clientX, y: e.clientY };
      };
      layer.onpointermove = (e) => {
        if (!start || tool !== "comment") { hovered = elementAt(e.clientX, e.clientY); return redraw(); }
        const left = Math.min(start.x, e.clientX), top = Math.min(start.y, e.clientY), width = Math.abs(e.clientX - start.x), height = Math.abs(e.clientY - start.y);
        if (!box && Math.max(width, height) < 6) return;
        if (!box) { box = areaBox(layer, 0, 0, 0, 0); layer.dragging = true; redraw(); }
        box.style.cssText = "left:" + left + "px;top:" + top + "px;width:" + width + "px;height:" + height + "px";
      };
      layer.onpointerup = (e) => {
        if (!start) return;
        const s = start; start = null;
        if (tool === "measure") { const el = elementAt(e.clientX, e.clientY); picked = picked === el ? null : el; return redraw(); }
        layer.dragging = false;
        if (box) {
          box.remove(); box = null;
          finishArea(Math.min(s.x, e.clientX), Math.min(s.y, e.clientY), Math.max(s.x, e.clientX), Math.max(s.y, e.clientY));
        } else finishArea(e.clientX, e.clientY, e.clientX, e.clientY);
        redraw();
      };
      layer.onpointerleave = () => { if (!start) { hovered = null; redraw(); } };
      layer.onpointercancel = () => { start = null; layer.dragging = false; if (box) { box.remove(); box = null; } };
      shadow.appendChild(layer);
    }
    redraw();
  }

  /**
   * Rulers along the top and left edges, in the page's own pixels, with guides: drag one out of a ruler, drag it to
   * move it, drag it back onto the ruler (or double-click it) to remove it. Guides sit in the page, so they scroll with it.
   */
  const RULER = 18;
  const rulerX = document.createElement("canvas"), rulerY = document.createElement("canvas"), corner = document.createElement("div");
  rulerX.className = "ru x"; rulerY.className = "ru y"; corner.className = "ru c";
  const guideLayer = document.createElement("div");
  let guides = [];
  function paintRuler(canvas, horizontal) {
    const dpr = devicePixelRatio || 1, length = (horizontal ? innerWidth : innerHeight) - RULER, offset = (horizontal ? scrollX : scrollY) + RULER;
    const w = horizontal ? length : RULER, h = horizontal ? RULER : length;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
    }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(host), tick = css.getPropertyValue("--tick").trim(), label = DARK ? "#a1a1aa" : "#64748b";
    g.font = "9px ui-sans-serif, system-ui, sans-serif";
    g.textAlign = "center";
    for (let v = Math.ceil(offset / 10) * 10; v < offset + length; v += 10) {
      const at = Math.round(v - offset) + 0.5, size = v % 100 === 0 ? 6 : v % 50 === 0 ? 4 : 2;
      g.fillStyle = tick;
      if (horizontal) g.fillRect(at, RULER - size, 1, size); else g.fillRect(RULER - size, at, size, 1);
      if (v % 100) continue;
      g.fillStyle = label;
      if (horizontal) g.fillText(String(v), at, 9);
      else { g.save(); g.translate(9, at); g.rotate(-Math.PI / 2); g.fillText(String(v), 0, 0); g.restore(); }
    }
    // Mesurer's red: the guides (the top ruler marks the upright ones, the left one the level ones), and the extents of
    // the element the tool is on, each with its position over a fade of the ruler's surface.
    const red = "#ef4444", surface = css.getPropertyValue("--sf").trim();
    const mark = (page, labelled) => {
      const at = Math.round(page - offset) + 0.5;
      if (at < 0 || at > length) return;
      g.fillStyle = red;
      if (horizontal) g.fillRect(at - 0.5, 0, 1, RULER); else g.fillRect(0, at - 0.5, RULER, 1);
      if (!labelled) return;
      const text = String(Math.round(page)), width = g.measureText(text).width + 6;
      g.fillStyle = surface;
      if (horizontal) g.fillRect(at - width / 2, 0, width, 11); else g.fillRect(0, at - width / 2, 11, width);
      g.fillStyle = red; g.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      if (horizontal) g.fillText(text, at, 9);
      else { g.save(); g.translate(9, at); g.rotate(-Math.PI / 2); g.fillText(text, 0, 0); g.restore(); }
      g.font = "9px ui-sans-serif, system-ui, sans-serif";
    };
    for (const guide of guides) if ((guide.axis === "v") === horizontal) mark(guide.at, false);
    const on = tool !== "browse" && (picked || hovered);
    if (on && on.isConnected) {
      const r = on.getBoundingClientRect(), scroll = horizontal ? scrollX : scrollY;
      mark((horizontal ? r.left : r.top) + scroll, true);
      mark((horizontal ? r.right : r.bottom) + scroll, true);
    }
  }
  function drawRulers() {
    const on = view.rulers;
    for (const el of [rulerX, rulerY, corner, guideLayer]) el.style.display = on ? "" : "none";
    if (!on) return;
    paintRuler(rulerX, true);
    paintRuler(rulerY, false);
    const doc = document.documentElement;
    guideLayer.innerHTML = "";
    for (const guide of guides) {
      const line = document.createElement("div");
      line.className = "gd " + guide.axis;
      line.style.cssText = guide.axis === "h" ? "top:" + guide.at + "px;width:" + doc.scrollWidth + "px" : "left:" + guide.at + "px;height:" + doc.scrollHeight + "px";
      line.onpointerdown = (e) => dragGuide(e, guide);
      line.ondblclick = () => { guides = guides.filter((g) => g !== guide); redraw(); };
      line.title = guide.axis === "h" ? "y " + px(guide.at) : "x " + px(guide.at);
      guideLayer.appendChild(line);
    }
  }
  // A guide follows the pointer until it's let go; over a ruler, or out of the page, it goes. The window listens, since
  // every redraw replaces the guide's line.
  function dragGuide(e, guide) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (!guides.includes(guide)) guides.push(guide);
    const place = (ev) => {
      const client = guide.axis === "h" ? ev.clientY : ev.clientX;
      guide.at = client + (guide.axis === "h" ? scrollY : scrollX);
      guide.out = client < RULER || client > (guide.axis === "h" ? innerHeight : innerWidth);
      drawTools();
      tag((guide.axis === "h" ? "y " : "x ") + px(guide.at), ev.clientX + 12, ev.clientY + 12, "d");
    };
    const done = () => {
      removeEventListener("pointermove", place, true);
      removeEventListener("pointerup", done, true);
      removeEventListener("pointercancel", done, true);
      if (guide.out) guides = guides.filter((g) => g !== guide);
      redraw();
    };
    addEventListener("pointermove", place, true);
    addEventListener("pointerup", done, true);
    addEventListener("pointercancel", done, true);
    place(e);
  }
  rulerX.onpointerdown = (e) => dragGuide(e, { axis: "h", at: 0 });
  rulerY.onpointerdown = (e) => dragGuide(e, { axis: "v", at: 0 });
  shadow.append(guideLayer, fx, rulerX, rulerY, corner);
  guideLayer.style.cssText = "position:absolute;left:0;top:0";

  // X-ray: every element's box, outlined. Outlines take no room, so the layout doesn't move.
  const xrayStyle = document.createElement("style");
  xrayStyle.textContent = "*:not(drop-comments){outline:1px solid oklch(0.62 0.18 255) !important;outline-offset:-1px !important}";
  function setView(next) {
    view.rulers = Boolean(next.rulers); view.pins = next.pins !== false;
    if (Boolean(next.xray) !== xrayStyle.isConnected) { if (next.xray) document.head.appendChild(xrayStyle); else xrayStyle.remove(); }
    view.xray = Boolean(next.xray);
    render(); redraw();
  }
  addEventListener("scroll", () => { if (tool !== "browse" || view.rulers) redraw(); }, { capture: true, passive: true });
  drawRulers();

  const onZoom = (e) => {
    zoom = e.detail && e.detail.layer && e.detail.content && e.detail.item && e.detail.copyOf ? e.detail : null;
    render();
  };
  document.addEventListener("comark-zoom:open", onZoom);
  document.addEventListener("comark-zoom:change", onZoom);
  document.addEventListener("comark-zoom:close", () => { zoom = null; render(); });

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent) return;
    if (m.type === "markers") { markers = m.markers; render(); }
    if (m.type === "clear-selection") { getSelection().removeAllRanges(); lastQuote = ""; draft.innerHTML = ""; zoomDraft(); }
    if (m.type === "tool" && /^(browse|comment|measure)$/.test(m.tool)) setTool(m.tool);
    if (m.type === "view") setView(m);
    if (m.type === "clear-area") { draft.innerHTML = ""; zoomDraft(); }
    // How much of the right edge Drop's floating panel covers. Drop's own documents read it to stay clear.
    if (m.type === "inset") { document.documentElement.style.setProperty("--drop-inset", (Number(m.right) || 0) + "px"); render(); }
    // How wide a Markdown doc's text runs (DOC_WIDTHS in shared/documents.ts).
    if (m.type === "width" && typeof m.column === "string") { document.documentElement.style.setProperty("--drop-column", m.column); render(); }
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
  // Escape under a tool unpicks the measured element, else goes to Drop, which closes what's open or puts the tool down.
  // Caught first, so Comark's zoom under the layer stays open.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || tool === "browse") return;
    e.stopPropagation();
    if (picked) { picked = null; return redraw(); }
    post({ type: "key", key: "Escape" });
  }, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") post({ type: "key", key: "Escape" });
    // Drop's tool shortcuts, for when the page has focus. Never while typing, and never once the page used the key.
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    const key = e.key.toLowerCase();
    if (/^[vrsux]$/.test(key) && !e.metaKey && !e.ctrlKey && !e.altKey && !typing && !e.defaultPrevented) post({ type: "key", key, tool });
  });
  window.addEventListener("resize", () => { render(); redraw(); });
  // The page and every anchor: an area must follow its element even when the page keeps its size.
  const resized = new ResizeObserver(render);
  resized.observe(document.documentElement);
  document.documentElement.appendChild(host);
  document.head.appendChild(pageStyle);
  post({ type: "ready" });
})();`

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

/**
 * Whether a page was written for Drop's theme (PLAN_AUTHORING_GUIDE): it reads Drop's tokens without setting its own.
 * A page with its own design, such as a Tailwind app, never gets Drop's fonts, base size, or dark class.
 */
const DROP_TOKEN =
  /var\(\s*--(?:background|foreground|muted|muted-foreground|card|border|primary|primary-foreground|destructive|code-background|chart-\d|positive|caution|negative)\s*[,)]/
const usesDropTheme = (html: string) => DROP_TOKEN.test(html) && !/--background\s*:/.test(html)

/**
 * Injects Drop's runtime into a full HTML document without touching the author's markup.
 * `inset`: the room the viewer's floating panel takes on the right at load, so the text starts clear of it.
 * `authored`: a page someone else built (an HTML doc or an app page), which gets only what comments need: Drop's
 * theme only if it reads Drop's tokens, and a comment layer that leaves its clicks alone (ANNOTATOR_SCRIPT).
 */
export function injectRuntime(html: string, dark: boolean, inset = 0, authored = false): string {
  const theme =
    authored && !usesDropTheme(html)
      ? ""
      : `<style data-drop-theme>${THEME_CSS}</style><script>document.documentElement.classList.toggle("dark", ${dark});</script>`
  const head = `<script>${ERROR_REPORTER}</script><script>${OPAQUE_ORIGIN_SHIM}</script>${theme}<script>document.documentElement.style.setProperty("--drop-inset", "${inset || 0}px");</script>`
  const tail = `<script>${ANNOTATOR_SCRIPT.replace("__AUTHORED__", String(authored)).replace("__THEMED__", String(Boolean(theme))).replace("__DARK__", String(dark))}</script>`
  let out = prependToHead(html, head)
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, tail + "</body>") : out + tail
  return out
}
