// What Drop injects into every plan document.
// The theme contract matches T3 Code's HTML renders (same shadcn token names, --chart-1…6, base stylesheet),
// so a page an agent built for T3 renders the same way in Drop.
import PICKER from "../skills/prototype/assets/picker.js?raw"
import THEME from "./theme.css?raw"
import { MAX_QUIZ_BLOCKS } from "./quiz"
import { CAPTURE } from "./viewport-capture"
import COMMENTS_CSS from "#comark-comments-css"

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

  // A rectangle anchors to the smallest element that holds it, never the script's own root (skip). What shows on top
  // counts first: the element on top and those it sits in. So a box drawn on an open tooltip or menu anchors to it, not
  // to a smaller row it covers. When only the page holds the box among those, any element under it counts.
  function anchorFor(left, top, right, bottom, skip) {
    const under = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).filter((el) => el !== skip && el !== document.documentElement && el.localName !== "drop-comments" && el.localName !== "drop-bubble");
    const smallest = (els) => {
      let best = null, bestArea = Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect(), area = r.width * r.height;
        if (r.width < 1 || r.height < 1 || r.left > left + 1 || r.top > top + 1 || r.right < right - 1 || r.bottom < bottom - 1) continue;
        if (area < bestArea) { best = el; bestArea = area; }
      }
      return best;
    };
    const front = under[0];
    return smallest(under.filter((el) => el !== document.body && front && el.contains(front))) || smallest(under) || front || document.body;
  }`

/**
 * Comment layer. Runs inside the drop's frame, on another origin than Drop, so it only talks to Drop via postMessage.
 * Select text to comment on it; click an image to zoom and comment on a spot. The viewer's toolbar picks a tool: with
 * Comment (R), click an element to pin a comment to it or drag a rectangle; with Measure, inspect sizes and distances;
 * with the Marker, draw on a still of the page and send it as a comment.
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
    // On what opens a closed tooltip or menu (standIn), not on the thing itself.
    '.m.away{outline:1.5px dashed var(--foreground);outline-offset:2px}' +
    '.cp{position:absolute;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:var(--card);box-shadow:0 0 0 1px var(--border),0 1px 2px rgb(0 0 0/.06);color:var(--muted-foreground);cursor:pointer;opacity:0;transition:opacity 150ms ease-out,color 150ms ease-out}' +
    '.cp::before{content:"";position:absolute;inset:-6px}.cp svg{width:15px;height:15px}' +
    '.cp:hover,.cp:focus-visible,.cp.on{opacity:1}.cp:hover{color:var(--foreground)}@media (hover:none){.cp{opacity:1}}' +
    '.a{position:absolute;box-sizing:border-box;border:calc(1.5px * var(--drop-z,1)) solid var(--foreground);border-radius:3px;background:color-mix(in oklab,var(--foreground) 6%,transparent);pointer-events:none;transition:background 120ms}' +
    '.a.done{border-style:dashed;border-color:var(--muted-foreground);background:none;opacity:.6}.a.pulse{background:color-mix(in oklab,var(--foreground) 16%,transparent)}.a.t{background:none}' +
    '.draw{position:fixed;inset:0;cursor:crosshair;touch-action:none}.draw .a{position:fixed}.draw.measure{cursor:default}' +
    // The Marker's strokes: on the snapshot in viewport pixels, then on the page while their comment is written.
    '.draw.mark{cursor:crosshair}.ink{position:fixed;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.inkp{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}' +
    '.ink path,.inkp path{fill:none;stroke-linecap:round;stroke-linejoin:round}.ink .mk,.inkp .mk{stroke-opacity:.4;stroke-linecap:butt}' +
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
  // comark-comments' own stylesheet for the cards of comments in the margin (see render), then where they go: each is
  // placed by hand, so it drops the package's floats and margins. The bubble each card follows is in the page (BUBBLES).
  const COMMENTS_CSS = __COMMENTS_CSS__;
  const RAIL_STYLE = '<style>' + COMMENTS_CSS +
    '.rail{position:absolute;height:0}.rail .g>.cr-bub{display:none}.rail .g>.cr-card{position:absolute;margin:0}.rail .cr-card{float:none;clear:none;cursor:pointer}' +
    '.rail .g:has(.cr-tg:checked)>*{z-index:1}.rail .cr-av{overflow:hidden}.rail .cr-av img{display:block;width:100%;height:100%;object-fit:cover}' +
    '.rail .cr-entry{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}' +
    '.rail .cr-card small{display:block;margin-top:.25rem;color:var(--_comark-muted);font-size:.75rem}' +
    '</style>';
  shadow.innerHTML = STYLE + RAIL_STYLE + LAYERS;
  const marks = shadow.querySelector(".marks"), draft = shadow.querySelector(".draft");
  // MingCute's copy and check, at the 1.75 stroke of Drop's own buttons (app.config icon.customize).
  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.75" d="M8 6V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2M4 21h11a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1Z"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="m3.514 11.83l5.657 5.656L20.485 6.172"/></svg>';
  const pageStyle = document.createElement("style");
  pageStyle.textContent = "::highlight(drop-open){background:color-mix(in oklab,var(--foreground) 13%,transparent)}::highlight(drop-done){background:color-mix(in oklab,var(--foreground) 6%,transparent)}::highlight(drop-active){background:color-mix(in oklab,var(--foreground) 26%,transparent)}" + (AUTHORED ? "" : "img:not(a[href] img){cursor:zoom-in}") +
    // Drop's review dock floats over the frame's bottom edge (--drop-bottom), out of reach of the page's own layers, so
    // Comark's zoom ends above it and its thumbnails stay clickable. Its backdrop still runs under the dock.
    ".cz-dialog{padding-bottom:var(--drop-bottom,0px)}";
  // Highlights draw on the page itself, so without Drop's theme they take a grey that shows on light and dark pages.
  if (!THEMED) pageStyle.textContent = pageStyle.textContent.replaceAll("var(--foreground)", "#808080");
  // A margin comment's bubble is the package's, in the page's own text after its quote, so it takes its room in the
  // line as a doc's thread does and covers nothing. It's a <drop-bubble> with no text of its own: quotes are found and
  // elements named (findRange, pathOf) as if it weren't there, and render() takes it out again. A word joiner keeps it
  // on its quote's line, and the count is generated. The quote takes the package's anchor look (.cr-cm), as a highlight.
  const BUBBLES = document.createElement("style");
  BUBBLES.textContent = COMMENTS_CSS +
    'drop-bubble.cr-bub:empty::before,drop-bubble.cr-bub b::before{content:"\\2060"}drop-bubble.cr-bub b{font:inherit;color:inherit}' +
    'drop-bubble.cr-bub b::before{content:"\\2060" attr(data-n)}drop-bubble.cr-bub[data-on]{color:var(--_comark-foreground);border-color:var(--_comark-ring)}' +
    // The package's .cr-cm tint and underline, on its own comment color, which the bubble resolves (render).
    "::highlight(drop-margin){background-color:color-mix(in srgb,var(--drop-anchor) 22%,transparent);text-decoration:underline 2px color-mix(in srgb,var(--drop-anchor) 80%,transparent);text-underline-offset:.25em}";
  // active: the comment a "focus" pulses for a moment; opened: the one whose thread Drop shows; pointed and textPointed:
  // the one under the pointer, over its bubble or card, or over its text.
  let markers = [], active = null, opened = null, pointed = null, textPointed = null;
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

  /**
   * Where a comment's pin goes while its element doesn't show: a tooltip, menu, or popover that closed, or a tab not
   * picked. It's the element that opens it (named by aria-describedby, aria-controls, and the like, or a link to it),
   * else the nearest element around it that shows. None for a prototype's variant that isn't on, or for something
   * only the whole page holds: those draw nothing until they show again.
   */
  const OPENERS = ["aria-describedby", "aria-labelledby", "aria-controls", "aria-owns", "popovertarget", "for"];
  // A tooltip that hides with visibility or opacity keeps its box, so its size alone doesn't tell.
  const shows = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    return typeof el.checkVisibility !== "function" || el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  };
  function standIn(el) {
    const variant = el.closest("[data-variant]");
    if (variant && !shows(variant)) return null;
    for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (shows(node)) return node;
      // The pin goes back once the element shows. A resize observer never reports an inline element such as a <b>, so
      // each hidden element around it is watched too: the one whose display changes is among them.
      resized.observe(node);
      if (!node.id) continue;
      const id = CSS.escape(node.id);
      const named = OPENERS.map((name) => "[" + name + '~="' + id + '"]').concat('a[href="#' + id + '"]').join(",");
      const opener = Array.from(document.querySelectorAll(named)).find((other) => !host.contains(other) && shows(other));
      if (opener) return opener;
    }
    return null;
  }

  const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "?";
  let lastUnplaced = null;
  // Open comments on a Markdown doc's text sit beside it, the way comark-comments draws a doc's own threads: a bubble
  // after the quote and a card in a margin on the right. The margin is --drop-rail, which widens the column
  // (shared/document-shell.css). It opens, as the package's does, once the text and the margin are 50rem together;
  // narrower, and for resolved comments or ones from earlier versions, each keeps its pin.
  const article = !AUTHORED && THEMED ? document.querySelector("main > article.typeset") : null;
  const inRail = (m) => Boolean(article) && m.kind === "text" && !m.resolved && !m.earlier;
  let textRanges = [], railHits = [];
  const bubbles = new Map();
  function clearBubbles() {
    for (const bubble of bubbles.values()) {
      const parent = bubble.parentNode;
      bubble.remove();
      // Its insertion split a text node in two; joined again, the page's DOM is as it was.
      if (parent) parent.normalize();
    }
    bubbles.clear();
  }
  function insertBubble(m, range) {
    const bubble = document.createElement("drop-bubble");
    bubble.className = "cr-bub"; bubble.dataset.dropBubble = ""; bubble.dataset.id = m.id; bubble.tabIndex = 0; bubble.setAttribute("role", "button");
    const replies = m.replies || 0;
    bubble.setAttribute("aria-label", "Comment by " + (m.author || "someone") + (replies ? ", " + replies + (replies === 1 ? " reply" : " replies") : ""));
    // Like the package's: the count only once the thread has more than its first comment.
    if (replies) { const count = document.createElement("b"); count.dataset.n = String(replies + 1); bubble.appendChild(count); }
    const end = range.cloneRange();
    end.collapse(false);
    end.insertNode(bubble);
    bubbles.set(m.id, bubble);
  }
  function setRail(want) {
    const root = document.documentElement;
    if (!want) return root.removeAttribute("data-drop-rail"), false;
    if (!root.hasAttribute("data-drop-rail")) root.setAttribute("data-drop-rail", "reserved");
    // The article's own width, padding included, so opening the margin doesn't change the answer.
    const wide = article.getBoundingClientRect().width >= 50 * (parseFloat(getComputedStyle(root).fontSize) || 16);
    root.setAttribute("data-drop-rail", wide ? "open" : "reserved");
    return wide;
  }
  function placePin(m, x, y, into, away) {
    const dot = document.createElement("div");
    dot.className = "m" + (m.kind !== "text" ? " img" : "") + (m.resolved ? " done" : "") + (m.id === active ? " pulse" : "") + (away ? " away" : "");
    // The author's picture, else their initials; the panel and the agent feedback keep the number.
    if (m.image) { const img = document.createElement("img"); img.src = m.image; img.alt = ""; img.referrerPolicy = "no-referrer"; img.onerror = () => { img.remove(); dot.textContent = initials(m.author); }; dot.appendChild(img); }
    else dot.textContent = initials(m.author);
    dot.title = (m.author || "Comment") + " · #" + m.n + (away ? " · on something that opens here" : "");
    dot.style.left = x + "px"; dot.style.top = y + "px"; dot.dataset.id = m.id;
    dot.onclick = (e) => { e.stopPropagation(); const r = dot.getBoundingClientRect(); post({ type: "marker", id: m.id, clientX: r.right, clientY: r.top }); };
    into.appendChild(dot);
  }

  function render() {
    marks.innerHTML = "";
    // Hidden comments (the toolbar's eye) keep their place. Shown before drawing, so the margin's cards measure their
    // size when the eye turns them back on.
    marks.style.display = view.pins ? "" : "none";
    const layer = zoom && zoomLayer(), zoomMarks = layer && layer.querySelector(".marks");
    const aside = zoomMarks && zoomAside(), asideMarks = aside && aside.querySelector(".marks");
    if (zoomMarks) zoomMarks.innerHTML = "";
    if (asideMarks) asideMarks.innerHTML = "";
    const unplaced = [], railed = [], standing = new Map();
    clearBubbles();
    // The quote is searched in its block first, then the whole page, so text that moved keeps its comment.
    const ranges = new Map(markers.filter((m) => m.kind === "text" && m.quote).map((m) => [m.id, findRange(m.selector, m.quote)]));
    // Under a zoom the page's comments don't draw, so the column stays as it was.
    const wide = zoom ? document.documentElement.getAttribute("data-drop-rail") === "open" : setRail(markers.some((m) => inRail(m) && ranges.get(m.id)));
    textRanges = [];
    if (wide && view.pins && !zoom) {
      if (!BUBBLES.isConnected) document.head.appendChild(BUBBLES);
      for (const m of markers) if (inRail(m) && ranges.get(m.id)) insertBubble(m, ranges.get(m.id));
      const bubble = bubbles.values().next().value;
      const anchor = bubble && getComputedStyle(bubble).getPropertyValue("--_cr-comment").trim();
      if (anchor && document.documentElement.style.getPropertyValue("--drop-anchor") !== anchor) document.documentElement.style.setProperty("--drop-anchor", anchor);
    }
    for (const m of markers) {
      let x, y, into = marks;
      if (m.kind === "image" || m.kind === "area") {
        // Placed from the anchor's current box, so areas and pins follow reflow.
        const el = query(m.selector);
        if (!el || (m.earlier && !sameAnchor(el, m))) { unplaced.push(m.id); continue; }
        resized.observe(el);
        const r = el.getBoundingClientRect();
        // A hidden anchor keeps a pin, without its area, on what stands in for it until it shows again.
        if (!shows(el)) {
          const stand = !zoom && standIn(el);
          if (!stand) continue;
          resized.observe(stand);
          const s = stand.getBoundingClientRect(), before = standing.get(stand) || 0;
          // Side by side when several wait on the same element, so each can be clicked.
          standing.set(stand, before + 1);
          x = s.right + scrollX + before * 24; y = s.top + scrollY;
          placePin(m, x, y, into, true);
          continue;
        }
        // While zoomed, only what the zoom shows draws, on its copy: the page's pins would float over the zoom.
        const copy = zoom && zoomMarks && copyOf(el);
        if (zoom && !copy) continue;
        const beside = copy && asideMarks && zoom.aside.contains(copy);
        const b = !copy ? { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height } : beside ? inAside(copy.getBoundingClientRect()) : inLayer(copy.getBoundingClientRect());
        if (copy) into = beside ? asideMarks : zoomMarks;
        x = b.left + (m.ox / 1000) * b.width; y = b.top + (m.oy / 1000) * b.height;
        if (m.ow || m.oh) areaBox(into, x, y, (m.ow / 1000) * b.width, (m.oh / 1000) * b.height, (m.resolved ? " done" : "") + (m.id === active ? " pulse" : ""));
      } else {
        const range = ranges.get(m.id);
        if (!range) { unplaced.push(m.id); continue; }
        const railedHere = bubbles.has(m.id);
        textRanges.push({ id: m.id, range, resolved: m.resolved, rail: railedHere });
        if (zoom) continue;
        const rects = range.getClientRects(), last = rects[rects.length - 1];
        if (!last) continue;
        // Outlined like an area, one box per line: a highlight alone can't draw a border, and its tint barely shows on
        // colored code. A line's pieces (one per token in highlighted code) join into one box.
        const lines = [];
        for (const r of rects) {
          if (!r.width) continue;
          const line = lines.find((l) => r.top < l.bottom && r.bottom > l.top);
          if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom); }
          else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        }
        if (railedHere) { railed.push({ m, last, lines }); continue; }
        for (const l of lines) areaBox(marks, l.left + scrollX - 2, l.top + scrollY - 1, l.right - l.left + 4, l.bottom - l.top + 2, " t" + (m.resolved ? " done" : "") + (m.id === active ? " pulse" : ""));
        x = last.right + scrollX + 2; y = last.top + scrollY;
      }
      placePin(m, x, y, into, false);
    }
    railHits = railed.map(({ m, lines }) => ({ id: m.id, boxes: lines.map((l) => ({ left: l.left + scrollX, right: l.right + scrollX, top: l.top + scrollY, bottom: l.bottom + scrollY })) }));
    if (railed.length) drawRail(railed);
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
    emphasise();
  }

  /**
   * The margin's cards, in comark-comments' markup: each is a hidden checkbox, a stand-in for its bubble (which is in the
   * page), and its card, so a checked box (emphasise) raises the card by the package's own rule. A card is level with
   * its line, below the card before it, and clear of the cards a doc's own threads float into the margin.
   */
  function drawRail(railed) {
    const box = article.getBoundingClientRect();
    const rail = document.createElement("div");
    rail.className = "cr rail";
    rail.style.cssText = "left:" + (box.left + scrollX) + "px;top:" + (box.top + scrollY) + "px;width:" + box.width + "px";
    marks.appendChild(rail);
    const taken = Array.from(document.querySelectorAll(".cr-card"), (card) => card.getBoundingClientRect())
      .filter((r) => r.height)
      .map((r) => ({ top: r.top - box.top, bottom: r.bottom - box.top }));
    let below = -Infinity;
    for (const { m, last } of railed.sort((a, b) => a.last.top - b.last.top || a.last.left - b.last.left)) {
      const group = document.createElement("div");
      group.className = "g"; group.dataset.id = m.id;
      const toggle = document.createElement("input");
      toggle.type = "checkbox"; toggle.className = "cr-tg"; toggle.tabIndex = -1; toggle.setAttribute("aria-hidden", "true");
      const replies = m.replies || 0;
      const stand = document.createElement("span"), bubble = bubbles.get(m.id);
      stand.className = "cr-bub";
      const card = document.createElement("div");
      card.className = "cr-card";
      const entry = document.createElement("span"), avatar = document.createElement("span"), name = document.createElement("b"), body = document.createElement("span");
      entry.className = "cr-entry"; avatar.className = "cr-av"; avatar.setAttribute("aria-hidden", "true");
      avatar.style.setProperty("--cr-av", "oklch(0.55 0.15 " + [...(m.author || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0) + ")");
      if (m.image) { const img = document.createElement("img"); img.src = m.image; img.alt = ""; img.referrerPolicy = "no-referrer"; img.onerror = () => { img.remove(); avatar.textContent = initials(m.author).slice(0, 1); }; avatar.appendChild(img); }
      else avatar.textContent = initials(m.author).slice(0, 1);
      name.textContent = m.author || "Comment";
      body.textContent = m.body || "";
      entry.append(avatar, name, body);
      card.appendChild(entry);
      if (replies) { const more = document.createElement("small"); more.textContent = replies + (replies === 1 ? " reply" : " replies"); card.appendChild(more); }
      group.append(toggle, stand, card);
      rail.appendChild(group);
      const height = card.offsetHeight;
      let top = Math.max(last.top - box.top, below + 8);
      for (let moved = true; moved; ) {
        moved = false;
        for (const t of taken) if (top < t.bottom + 8 && top + height > t.top - 8) { top = t.bottom + 8; moved = true; }
      }
      card.style.right = "0"; card.style.top = top + "px";
      below = top + height;
      const point = (on) => () => { if (on) pointed = m.id; else if (pointed === m.id) pointed = null; emphasise(); };
      for (const el of [bubble, card]) {
        el.onmouseenter = point(true); el.onmouseleave = point(false);
        el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const r = el.getBoundingClientRect(); post({ type: "marker", id: m.id, clientX: r.right, clientY: r.top }); };
      }
      bubble.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bubble.click(); } };
    }
  }

  /** The comment Drop shows, the one a "focus" picked, and the one under the pointer: their highlight and card stand out. */
  function emphasise() {
    const on = new Set([active, opened, pointed, textPointed].filter(Boolean));
    marks.querySelectorAll(".rail .g").forEach((group) => { group.firstElementChild.checked = on.has(group.dataset.id); });
    for (const [id, bubble] of bubbles) bubble.toggleAttribute("data-on", on.has(id));
    if (!highlights) return;
    const show = (pick) => new Highlight(...(view.pins ? textRanges.filter(pick).map((t) => t.range) : []));
    CSS.highlights.set("drop-margin", show((t) => !on.has(t.id) && t.rail));
    CSS.highlights.set("drop-open", show((t) => !on.has(t.id) && !t.resolved && !t.rail));
    CSS.highlights.set("drop-done", show((t) => !on.has(t.id) && t.resolved));
    CSS.highlights.set("drop-active", show((t) => on.has(t.id)));
  }
  // Over a margin comment's text, its card and bubble stand out too.
  let pointerFrame = 0;
  document.addEventListener("mousemove", (e) => {
    if ((!railHits.length && !textPointed) || pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      const x = e.clientX + scrollX, y = e.clientY + scrollY;
      const hit = railHits.find((h) => h.boxes.some((b) => x >= b.left - 2 && x <= b.right + 2 && y >= b.top && y <= b.bottom));
      const id = hit ? hit.id : null;
      if (id !== textPointed) { textPointed = id; emphasise(); }
    });
  }, { passive: true });
  function clearPointed() {
    // A queued hit from the last move must not restore hover after the pointer leaves the frame.
    cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    if (!pointed && !textPointed) return;
    pointed = textPointed = null;
    emphasise();
  }
  document.addEventListener("mouseleave", clearPointed);
  window.addEventListener("blur", clearPointed);

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
    const img = !AUTHORED && !zoomed && target && !target.closest("a[href]") && target.closest("img");
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
   * Comment draws an area; image drops also take point comments. Element inspection belongs to Measure.
   * Measure shows the element's size and box model, its type and colors, and, once one is picked, the distances from
   * it to whatever the pointer is over.
   */
  let tool = "browse", layer = null, hovered = null, picked = null, pointComments = false;
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
    const around = !zoom && under.closest(TRANSIENT);
    const n = around ? ++shots : undefined;
    post({ type: "area", selector: pathOf(el), label: labelOf(under), ox, oy, ow, oh, rect: { left, top, right, bottom }, shot: n });
    if (around) shoot(n, around.getBoundingClientRect(), left, top, right, bottom);
  }

  ${CAPTURE}
  /**
   * A comment on something that shows only for a while (a tooltip, a menu, a popover, a dialog) keeps a picture of it,
   * since the page won't show it once it closes: the viewport, cut to that element and the box with some room around,
   * with the box drawn on. Drop adds it to the comment being written ("area-shot", by the area's number). A page that
   * blocks the screenshot module gets no picture and the comment still goes.
   */
  const TRANSIENT = "[role=tooltip],[role=menu],[role=listbox],[role=dialog],[role=alertdialog],[popover],dialog,[data-state=open]";
  let shots = 0;
  async function shoot(n, around, left, top, right, bottom) {
    const ROOM = 24;
    const cut = {
      left: Math.max(0, Math.min(left, around.left) - ROOM), top: Math.max(0, Math.min(top, around.top) - ROOM),
      right: Math.min(innerWidth, Math.max(right, around.right) + ROOM), bottom: Math.min(innerHeight, Math.max(bottom, around.bottom) + ROOM),
    };
    // Drop waits for it before it sends the comment, so a picture that can't be taken says so.
    let image = null;
    try {
      const viewport = await captureViewport(host);
      if (!viewport || cut.right <= cut.left || cut.bottom <= cut.top) return;
      const bitmap = await createImageBitmap(viewport), k = bitmap.width / innerWidth;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round((cut.right - cut.left) * k); canvas.height = Math.round((cut.bottom - cut.top) * k);
      const g = canvas.getContext("2d");
      g.drawImage(bitmap, cut.left * k, cut.top * k, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      // Dark on a white edge, so the box shows on light and dark pages.
      if (right > left) for (const [color, width] of [["#fff", 4], ["#171717", 2]]) {
        g.strokeStyle = color; g.lineWidth = width * k;
        g.strokeRect((left - cut.left) * k, (top - cut.top) * k, (right - left) * k, (bottom - top) * k);
      }
      image = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    } catch {} finally {
      post({ type: "area-shot", shot: n, image });
    }
  }

  // The element under a point, past Drop's own layer.
  function elementAt(x, y) {
    return document.elementsFromPoint(x, y).find((el) => el !== host && el !== document.documentElement && el.localName !== "drop-comments" && el.localName !== "drop-bubble") || document.body;
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

  // Under a tool, EVENT_HOLD stops the page's events at the window and hands them here. Each reaches the handlers of
  // Drop's own elements it passed through, from the one under the pointer out to Drop's root, and a guide being dragged.
  let dragging = null;
  // What the pointer was over when the hold began, and where it is since: null while it hasn't moved, "out" once it
  // left the page.
  let heldHover = [], pointer = null;
  function held(e) {
    const path = e.composedPath(), root = path.findIndex((node) => node.localName === "drop-comments");
    for (const node of path.slice(0, Math.max(0, root))) {
      const handler = node["on" + e.type];
      if (typeof handler === "function") handler.call(node, e);
    }
    if (dragging && /^pointer(move|up|cancel)$/.test(e.type)) dragging(e);
    if (e.type === "pointermove") pointer = { x: e.clientX, y: e.clientY };
    if (e.type === "pointerout" && !e.relatedTarget) pointer = "out";
  }
  /**
   * The page missed the pointer leaving what it was over when the hold began. Once the hold ends, each element the
   * pointer is no longer over hears it leave, so a tooltip that opened on hover closes as it would have.
   */
  function leaveHeld() {
    const was = heldHover;
    heldHover = [];
    if (pointer === null) return;
    const at = pointer === "out" ? null : elementAt(pointer.x, pointer.y), over = new Set();
    for (let node = at; node; node = node.parentElement) over.add(node);
    const left = was.filter((el) => el.isConnected && !over.has(el)).reverse();
    const init = { clientX: pointer === "out" ? -1 : pointer.x, clientY: pointer === "out" ? -1 : pointer.y, relatedTarget: at, pointerId: 1, pointerType: "mouse", isPrimary: true };
    if (left[0]) { left[0].dispatchEvent(new PointerEvent("pointerout", { ...init, bubbles: true })); left[0].dispatchEvent(new MouseEvent("mouseout", { ...init, bubbles: true })); }
    for (const el of left) { el.dispatchEvent(new PointerEvent("pointerleave", init)); el.dispatchEvent(new MouseEvent("mouseleave", init)); }
  }
  // A modal dialog sits above the page, Drop's layer included, and makes the rest inert: under a tool, the layer goes in it.
  function modalShadow() {
    let modal = null;
    try { modal = document.querySelector("dialog:modal"); } catch {}
    if (!modal) return null;
    const inner = document.createElement("drop-comments");
    inner.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;";
    inner.attachShadow({ mode: "open" }).innerHTML = STYLE;
    modal.appendChild(inner);
    return inner.shadowRoot;
  }

  function setTool(next) {
    if (next === tool) return;
    const wasHeld = tool !== "browse";
    if (tool === "mark") leaveMark();
    tool = next;
    self.__dropHold(tool === "browse" ? null : held);
    if (!wasHeld && tool !== "browse") { heldHover = Array.from(document.querySelectorAll(":hover")); pointer = null; }
    // The picture a comment on a tooltip or menu keeps (shoot) starts sooner with its module loaded.
    if (tool === "comment" && document.querySelector(TRANSIENT)) loadScreenshot().catch(() => { screenshotModule = null; });
    hovered = picked = null;
    if (layer) {
      const root = layer.getRootNode();
      layer.remove(); layer = null;
      if (root !== shadow && root.host) root.host.remove();
    }
    if (wasHeld && tool === "browse") leaveHeld();
    if (tool === "mark") {
      getSelection().removeAllRanges();
      if (lastQuote) post({ type: "selection", clear: true });
      lastQuote = "";
      layer = markLayer();
      (modalShadow() || shadow).appendChild(layer);
    } else if (tool !== "browse") {
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
        } else if (pointComments) finishArea(e.clientX, e.clientY, e.clientX, e.clientY);
        redraw();
      };
      layer.onpointerleave = () => { if (!start) { hovered = null; redraw(); } };
      layer.onpointercancel = () => { start = null; layer.dragging = false; if (box) { box.remove(); box = null; } };
      (modalShadow() || shadow).appendChild(layer);
    }
    redraw();
  }

  /**
   * The Marker: the reader marks up a still of the page and sends it as one comment. Picking it freezes the page as it
   * is: the page hears no pointer while a tool is on (EVENT_HOLD), and what's under the pointer keeps its hover look
   * too, since each :hover rule also matches [data-drop-hover], which those elements carry. So a tooltip, even one
   * shown only by CSS, stays open. The viewport's screenshot starts then,
   * and a layer over the page takes the strokes (marker, pen, or arrow, in viewport pixels) and holds the scroll still.
   * Done anchors the comment to the smallest element under the strokes, reads the words under them, draws the strokes
   * on the screenshot, and posts the area, then the picture as its "area-shot", which Drop adds to the comment. The
   * strokes stay on the page while the comment is written; Drop clears them with the area. A page whose CSP blocks the
   * screenshot sends the area with no picture.
   */
  const SVG = "http://www.w3.org/2000/svg";
  let pen = { tool: "marker", color: "#ec4899", width: 14 }, strokes = [], stroke = null, shot = null, frozen = null, ink = null;
  let markSession = 0, finishing = false;
  function setPen(next) {
    if (/^(marker|pen|arrow)$/.test(next.tool)) pen.tool = next.tool;
    if (/^#[0-9a-f]{6}$/i.test(next.color)) pen.color = next.color;
    if (typeof next.width === "number" && next.width >= 1 && next.width <= 64) pen.width = next.width;
    if (layer && tool === "mark") layer.style.cursor = penCursor();
  }
  // The pointer is the tip: its size and colour, see-through for the marker. The arrow keeps the crosshair.
  function penCursor() {
    if (pen.tool === "arrow") return "";
    const d = Math.max(8, Math.ceil(pen.width) + 4), r = d / 2;
    const svg = '<svg xmlns="' + SVG + '" width="' + d + '" height="' + d + '"><circle cx="' + r + '" cy="' + r + '" r="' + Math.max(2, pen.width / 2) + '" fill="' + pen.color + '" fill-opacity="' + (pen.tool === "marker" ? 0.4 : 0.9) + '" stroke="#0a0a0a" stroke-opacity=".55"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + r + " " + r + ", crosshair";
  }
  const pt = (p) => p[0].toFixed(1) + " " + p[1].toFixed(1);
  function smoothPath(points) {
    if (points.length === 1) return "M" + pt(points[0]) + "l0.1 0";
    let d = "M" + pt(points[0]);
    for (let i = 1; i < points.length - 1; i++) d += "Q" + pt(points[i]) + " " + pt([(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2]);
    return d + "L" + pt(points[points.length - 1]);
  }
  // A hand-drawn arrow: the shaft bows a little unless Shift keeps it straight, and the head is two strokes along its end.
  function arrowPath(a, b, straight, width) {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1, bow = straight ? 0 : Math.min(18, length * 0.08);
    const c = [(a[0] + b[0]) / 2 - (dy / length) * bow, (a[1] + b[1]) / 2 + (dx / length) * bow];
    const angle = Math.atan2(b[1] - c[1], b[0] - c[0]), head = Math.min(14, length * 0.4) + width;
    const side = (turn) => [b[0] - head * Math.cos(angle + turn), b[1] - head * Math.sin(angle + turn)];
    return "M" + pt(a) + "Q" + pt(c) + " " + pt(b) + "M" + pt(side(-0.5)) + "L" + pt(b) + "L" + pt(side(0.5));
  }
  const strokePath = (s) => (s.tool === "arrow" ? arrowPath(s.points[0], s.points[s.points.length - 1], s.straight, s.width) : smoothPath(s.points));
  function drawStroke(s, into) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", strokePath(s));
    path.setAttribute("stroke", s.color);
    path.setAttribute("stroke-width", String(s.width));
    if (s.tool === "marker") path.setAttribute("class", "mk");
    into.appendChild(path);
    return path;
  }

  function freeze() {
    const roots = [document], hovering = [], styles = [];
    for (const root of roots) {
      // Selectors and stylesheets are scoped to each root, including nested web components.
      for (const el of root.querySelectorAll("*")) if (el !== host && el.shadowRoot) roots.push(el.shadowRoot);
      const over = Array.from(root.querySelectorAll(":hover"));
      over.forEach((el) => el.setAttribute("data-drop-hover", ""));
      hovering.push(...over);
      // A stylesheet from another origin can't be read, so its hover looks go when the pointer moves.
      const rules = [];
      for (const sheet of new Set([...root.styleSheets, ...root.adoptedStyleSheets])) {
        let list = null;
        try { list = sheet.cssRules; } catch (e) { continue; }
        for (const rule of Array.from(list || [])) if (rule.cssText.includes(":hover")) rules.push(rule.cssText.replace(/:hover/g, "[data-drop-hover]"));
      }
      const style = document.createElement("style");
      style.textContent = rules.join("\n");
      (root === document ? document.head : root).appendChild(style);
      styles.push(style);
    }
    frozen = { hovering, styles };
  }
  function unfreeze() {
    if (!frozen) return;
    frozen.hovering.forEach((el) => el.removeAttribute("data-drop-hover"));
    frozen.styles.forEach((style) => style.remove());
    frozen = null;
  }
  function markLayer() {
    freeze();
    shot = captureViewport(host).catch(() => null);
    strokes = [];
    const el = document.createElement("div");
    el.className = "draw mark";
    el.style.cursor = penCursor();
    ink = document.createElementNS(SVG, "svg");
    ink.setAttribute("class", "ink");
    el.appendChild(ink);
    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      stroke = { tool: pen.tool, color: pen.color, width: pen.width, points: [[e.clientX, e.clientY]], straight: false };
      stroke.el = drawStroke(stroke, ink);
    };
    el.onpointermove = (e) => {
      if (!stroke) return;
      const p = [e.clientX, e.clientY], first = stroke.points[0];
      // Shift draws straight: a marker stays on its line, a pen and an arrow go point to point.
      if (stroke.tool === "arrow" || e.shiftKey) {
        stroke.straight = e.shiftKey;
        stroke.points = [first, stroke.tool === "marker" && e.shiftKey ? [p[0], first[1]] : p];
      } else {
        const last = stroke.points[stroke.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 2) stroke.points.push(p);
      }
      stroke.el.setAttribute("d", strokePath(stroke));
    };
    el.onpointerup = el.onpointercancel = () => {
      if (!stroke) return;
      const s = stroke, a = s.points[0], b = s.points[s.points.length - 1];
      stroke = null;
      if (s.tool === "arrow" && Math.hypot(b[0] - a[0], b[1] - a[1]) < 10) return s.el.remove();
      strokes.push(s);
      post({ type: "marks", count: strokes.length });
    };
    // The snapshot is of the viewport, so the page stays where it is under it.
    el.onwheel = el.ontouchmove = (e) => e.preventDefault();
    return el;
  }
  function leaveMark() {
    markSession++; finishing = false;
    unfreeze();
    strokes = []; stroke = null; shot = null; ink = null;
    post({ type: "marks", count: 0 });
  }
  function undoMark() {
    const s = strokes.pop();
    if (s) s.el.remove();
    post({ type: "marks", count: strokes.length });
  }

  // The words under the strokes, one phrase per block, in reading order: the marker's whole width, a pen's line, the
  // inside of a loop drawn with the pen, and the word an arrow points at.
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p && { node: p.offsetNode, offset: p.offset }; }
    const r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    return r && { node: r.startContainer, offset: r.startOffset };
  }
  function wordAt(x, y, slack) {
    const c = caretAt(x, y);
    if (!c || !c.node || c.node.nodeType !== 3 || host.contains(c.node)) return null;
    const t = c.node.data;
    let start = Math.min(c.offset, t.length), end = start;
    while (start > 0 && /\S/.test(t[start - 1])) start--;
    while (end < t.length && /\S/.test(t[end])) end++;
    if (start === end) return null;
    const range = document.createRange();
    range.setStart(c.node, start); range.setEnd(c.node, end);
    const b = range.getBoundingClientRect();
    if (x < b.left - slack || x > b.right + slack || y < b.top - slack || y > b.bottom + slack) return null;
    return { node: c.node, start, end };
  }
  function along(points) {
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i], n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 5));
      for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
    return out;
  }
  function inside(points) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const gap = Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
    if (points.length < 10 || x1 - x0 < 16 || y1 - y0 < 12 || gap > Math.max(28, 0.3 * Math.hypot(x1 - x0, y1 - y0))) return [];
    const out = [];
    for (let x = x0; x <= x1; x += 7) for (let y = y0; y <= y1; y += 7) {
      let hit = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      if (hit) out.push([x, y]);
    }
    return out;
  }
  function markedText(list) {
    const words = new Map(), ids = new Map();
    const keyOf = (w) => { if (!ids.has(w.node)) ids.set(w.node, ids.size); return ids.get(w.node) + ":" + w.start; };
    const take = (x, y, slack) => { const w = wordAt(x, y, slack); if (w) words.set(keyOf(w), w); };
    for (const s of list) {
      if (s.tool === "arrow") { const [x, y] = s.points[s.points.length - 1]; take(x, y, 10); continue; }
      const third = s.width / 3;
      for (const [x, y] of along(s.points)) {
        take(x, y, s.tool === "marker" ? s.width / 2 : 4);
        if (s.tool === "marker") { take(x, y - third, s.width / 2); take(x, y + third, s.width / 2); }
      }
      if (s.tool === "pen") for (const [x, y] of inside(s.points)) take(x, y, 2);
    }
    const sorted = Array.from(words.values()).sort((a, b) =>
      a.node === b.node ? a.start - b.start : a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const groups = [];
    for (const w of sorted) {
      const block = blockOf(w.node), last = groups[groups.length - 1];
      if (last && last.block === block) last.to = w; else groups.push({ block, from: w, to: w });
    }
    return groups.map(({ from, to }) => {
      const range = document.createRange();
      range.setStart(from.node, from.start); range.setEnd(to.node, to.end);
      return range.toString().replace(/\s+/g, " ").trim();
    }).filter(Boolean).join(" … ").slice(0, 2000);
  }
  // The screenshot with the strokes on it, as the reader saw them, cut to the strokes and some of what's around them
  // (at least 640 by 360). The marker multiplies, so the words under it stay dark.
  async function drawOn(picture, list, box) {
    const image = await createImageBitmap(picture), k = image.width / innerWidth;
    const grow = (from, to, min, max) => {
      let a = from - 120, b = to + 120;
      if (b - a < min) { a -= (min - (b - a)) / 2; b = a + min; }
      if (a < 0) { b -= a; a = 0; }
      if (b > max) { a -= b - max; b = max; }
      return [Math.max(0, a), Math.min(max, b)];
    };
    const [x0, x1] = grow(box.left, box.right, 640, innerWidth), [y0, y1] = grow(box.top, box.bottom, 360, innerHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((x1 - x0) * k); canvas.height = Math.round((y1 - y0) * k);
    const g = canvas.getContext("2d");
    g.drawImage(image, -x0 * k, -y0 * k);
    g.scale(k, k);
    g.translate(-x0, -y0);
    for (const s of list) {
      g.save();
      g.globalAlpha = s.tool === "marker" ? 0.4 : 1;
      g.globalCompositeOperation = s.tool === "marker" ? "multiply" : "source-over";
      g.strokeStyle = s.color; g.lineWidth = s.width; g.lineCap = s.tool === "marker" ? "butt" : "round"; g.lineJoin = "round";
      g.stroke(new Path2D(strokePath(s)));
      g.restore();
    }
    const blob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    let out = await blob("image/webp", 0.9);
    if (!out || out.size > MAX_BYTES) out = await blob("image/jpeg", 0.8);
    return out && out.size <= MAX_BYTES ? out : null;
  }
  async function finishMark() {
    if (tool !== "mark" || !strokes.length || finishing) return;
    finishing = true;
    const list = strokes.slice(), picture = shot, session = markSession;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const s of list) {
      // The rendered path includes an arrow's bow and head, beyond its pointer endpoints.
      const b = s.el.getBBox(), pad = s.width / 2 + 2;
      left = Math.min(left, b.x - pad); top = Math.min(top, b.y - pad); right = Math.max(right, b.x + b.width + pad); bottom = Math.max(bottom, b.y + b.height + pad);
    }
    [left, right] = [Math.max(0, left), Math.min(innerWidth, right)];
    [top, bottom] = [Math.max(0, top), Math.min(innerHeight, bottom)];
    // The layer steps aside, so the hit tests reach the page under it.
    layer.style.pointerEvents = "none";
    const under = anchorFor(left, top, right, bottom, host), quote = markedText(list);
    layer.style.pointerEvents = "";
    const r = under.getBoundingClientRect();
    const ox = thousandths(left, r.left, r.width), oy = thousandths(top, r.top, r.height);
    const ow = Math.max(1, Math.min(1000 - ox, thousandths(right, r.left, r.width) - ox));
    const oh = Math.max(1, Math.min(1000 - oy, thousandths(bottom, r.top, r.height) - oy));
    draft.innerHTML = "";
    const kept = document.createElementNS(SVG, "svg");
    kept.setAttribute("class", "inkp");
    for (const s of list) drawStroke(Object.assign({}, s, { points: s.points.map(([x, y]) => [x + scrollX, y + scrollY]) }), kept);
    draft.appendChild(kept);
    // Done waits for the picture, so it shows the page as frozen, before the hold and the hover look end.
    let marked = null;
    try { const taken = await picture; marked = taken ? await drawOn(taken, list, { left, top, right, bottom }) : null; } catch (e) { marked = null; }
    // A canceled capture must not post or change a newer session's preview or in-flight Done.
    if (session !== markSession || tool !== "mark") return;
    finishing = false;
    const n = ++shots;
    post({ type: "area", selector: pathOf(under), label: labelOf(under), ox, oy, ow, oh, rect: { left, top, right, bottom }, quote: quote || undefined, shot: n });
    post({ type: "area-shot", shot: n, image: marked });
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
      dragging = null;
      removeEventListener("pointermove", place, true);
      removeEventListener("pointerup", done, true);
      removeEventListener("pointercancel", done, true);
      if (guide.out) guides = guides.filter((g) => g !== guide);
      redraw();
    };
    // Under a tool these window listeners hear nothing (held), so the drag goes through there too.
    dragging = (ev) => (ev.type === "pointermove" ? place(ev) : done());
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
    // Answered once the page is held, so Drop can take focus without the page seeing it go (EVENT_HOLD).
    if (m.type === "tool" && /^(browse|comment|measure|mark)$/.test(m.tool)) { pointComments = m.pointComments === true; if (m.pen) setPen(m.pen); setTool(m.tool); post({ type: "tool", tool }); }
    if (m.type === "pen") setPen(m);
    if (m.type === "mark" && m.do === "undo") undoMark();
    if (m.type === "mark" && m.do === "done") finishMark();
    if (m.type === "view") setView(m);
    if (m.type === "clear-area") { draft.innerHTML = ""; zoomDraft(); }
    // How much of the right edge Drop's floating panel covers. Drop's own documents read it to stay clear.
    if (m.type === "inset") {
      document.documentElement.style.setProperty("--drop-inset", (Number(m.right) || 0) + "px");
      document.documentElement.style.setProperty("--drop-bottom", (Number(m.bottom) || 0) + "px");
      render();
    }
    // How wide a Markdown doc's text runs (DOC_WIDTHS in shared/documents.ts).
    if (m.type === "width" && typeof m.column === "string") { document.documentElement.style.setProperty("--drop-column", m.column); render(); }
    // The comment whose thread Drop shows, if any: its card stays raised and its text marked while it's open.
    if (m.type === "active") { opened = typeof m.id === "string" ? m.id : null; emphasise(); }
    if (m.type === "focus") {
      active = m.id; render();
      // A pin, or a margin comment's bubble.
      const pinOf = () => (typeof m.id === "string" && (marks.querySelector('.m[data-id="' + CSS.escape(m.id) + '"]') || bubbles.get(m.id))) || null;
      const dot = pinOf();
      if (dot) scrollTo({ top: Math.max(0, dot.getBoundingClientRect().top + scrollY - innerHeight / 3), behavior: "smooth" });
      // With open: once the scroll settles, report the pin like a click, so Drop opens its thread beside it. Marked
      // focused, so Drop can drop the report if Escape or another comment came first.
      if (dot && m.open) setTimeout(() => {
        const pin = pinOf();
        if (pin) { const r = pin.getBoundingClientRect(); post({ type: "marker", id: m.id, clientX: r.right, clientY: r.top, focused: true }); }
      }, 500);
      setTimeout(() => { active = null; render(); }, 2200);
    }
  });
  // Escape under a tool unpicks the measured element, else goes to Drop, which closes what's open or puts the tool down.
  // Caught first, so Comark's zoom under the layer stays open.
  window.addEventListener("keydown", (e) => {
    // The screenshot and ink use viewport coordinates, including when the page still has keyboard focus.
    if (tool === "mark" && /^( |ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End)$/.test(e.key)) {
      e.preventDefault(); e.stopPropagation(); return;
    }
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
    // The Marker's own keys: Enter sends the snapshot, ⌘Z or Ctrl+Z takes back the last stroke.
    if (tool === "mark" && !typing && !e.altKey && !e.defaultPrevented) {
      if (key === "enter") { e.preventDefault(); return finishMark(); }
      if ((e.metaKey || e.ctrlKey) && key === "z") { e.preventDefault(); return undoMark(); }
    }
    if (e.metaKey || e.ctrlKey || e.altKey || typing || e.defaultPrevented) return;
    if (/^[vrsuxbpa]$/.test(key) || (tool === "mark" && (key === "[" || key === "]"))) post({ type: "key", key, tool });
    // An image's page (the one Drop takes point comments on) has no use for ← and →: Drop moves to the folder's next image.
    if (pointComments && (e.key === "ArrowLeft" || e.key === "ArrowRight")) post({ type: "key", key: e.key });
  });
  // A quick sideways swipe across an image's page moves the same way. Not while pinch-zoomed in, where a swipe pans,
  // and not under a tool, where a drag draws or measures.
  let swipe = null;
  window.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    swipe = pointComments && tool === "browse" && e.touches.length === 1 && (visualViewport?.scale ?? 1) <= 1
      ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
  }, { passive: true });
  window.addEventListener("touchcancel", () => { swipe = null; });
  window.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const dx = swipe && t ? t.clientX - swipe.x : 0, dy = swipe && t ? t.clientY - swipe.y : 0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && e.timeStamp - swipe.at < 600)
      post({ type: "key", key: dx < 0 ? "ArrowRight" : "ArrowLeft" });
    swipe = null;
  });
  window.addEventListener("resize", () => { render(); redraw(); });
  // A web font that arrives late moves the words, and with them each comment's bubble and card.
  if (document.fonts) document.fonts.addEventListener("loadingdone", () => render());
  // So does a block that scrolls on its own, such as a wide table, under a comment in the margin.
  let scrollFrame = 0;
  addEventListener("scroll", (e) => {
    if (e.target === document || !railHits.length || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; render(); });
  }, { capture: true, passive: true });
  // The page and every anchor: an area must follow its element even when the page keeps its size.
  const resized = new ResizeObserver(render);
  resized.observe(document.documentElement);
  // An element that shows or hides without changing size, such as a tooltip that fades, changes a class, a style, or
  // its hidden or open attribute, or ends a transition: pins on elements are placed again then. Drop's own changes
  // (the root's custom properties, its hosts in the page) don't count.
  let reshowTimer = 0;
  const reshow = () => {
    if (reshowTimer || !markers.some((m) => m.kind !== "text")) return;
    reshowTimer = setTimeout(() => { reshowTimer = 0; render(); }, 100);
  };
  new MutationObserver((records) => {
    if (records.some((r) => r.target !== document.documentElement && r.target.localName !== "drop-comments")) reshow();
  }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class", "style", "hidden", "open"] });
  document.addEventListener("transitionend", reshow, true);
  document.documentElement.appendChild(host);
  document.head.appendChild(pageStyle);
  post({ type: "ready" });
})();`

/**
 * While a tool is on (the comment layer's setTool), the page hears none of the pointer, mouse, touch, and focus events.
 * A tooltip, menu, or popover it has open stays open as the reviewer opened it: it misses the pointer leaving it for the
 * layer over the page, the click that ends a drawn box, and the blur when Drop's composer takes focus. It runs first in
 * the head, so its listeners come before any the page adds, and the layer gets what it stopped through `__dropHold`.
 */
const EVENT_HOLD = String.raw`(() => {
  let hold = null;
  Object.defineProperty(self, "__dropHold", { value: (fn) => { hold = typeof fn === "function" ? fn : null; } });
  const POINTER = ["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel", "gotpointercapture", "lostpointercapture",
    "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave", "click", "dblclick", "auxclick", "contextmenu", "focus", "blur", "focusin", "focusout"];
  const stop = (e) => { if (!hold) return; e.stopImmediatePropagation(); hold(e); };
  for (const type of POINTER) addEventListener(type, stop, true);
  // Passive, so scrolling never waits on them; Drop's layer takes pointer events, not these.
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) addEventListener(type, stop, { capture: true, passive: true });
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

/**
 * The host side of comark-quiz's questions, polls, and recall cards (#shared/quiz), for Markdown docs. The frame can't
 * reach Drop's API, so each answer goes up to the viewer, which keeps it, and what the reader may see comes back down:
 * their answers, the results of the blocks they answered, and whether they can vote. It goes first in the head, so it
 * hears the blocks' script start, and hands that script the last state again then, since the viewer may send it first.
 */
export const QUIZ_BRIDGE = String.raw`(() => {
  const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
  let state = null;
  const apply = () => { if (state) document.dispatchEvent(new CustomEvent("comark-quiz:state", { detail: state })); };
  document.addEventListener("comark-quiz:ready", (e) => {
    const ids = e.detail && Array.isArray(e.detail.ids) ? e.detail.ids : [];
    post({ type: "quiz-ready", ids: ids.slice(0, ${MAX_QUIZ_BLOCKS}).map(String) });
    apply();
  });
  // Only what Drop reads, copied: a detail may hold what postMessage can't send. Drop knows which answer came first.
  document.addEventListener("comark-quiz:answer", (e) => {
    const d = e.detail || {};
    post({ type: "quiz-answer", answer: {
      id: typeof d.id === "string" ? d.id : "",
      kind: String(d.kind),
      choice: Array.isArray(d.choice) ? d.choice.map(String) : [],
      correct: typeof d.correct === "boolean" ? d.correct : null,
    } });
  });
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent || m.type !== "quiz-state" || !m.state) return;
    state = m.state;
    apply();
  });
})()`

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
 * A prototype (skills/prototype) carries its own copy of the skill's picker.js in a script element. Match its whole
 * source inside that element, so authored text and scripts quoting the picker stay intact. Drop runs the current
 * picker in that copy's place, so a prototype published before a picker change still works with Drop's bar.
 */
const EMBEDDED_PICKER = /^\s*\/\/ Drop prototype picker\.[\s\S]*\n\}\)\(\);\s*$/
function upgradePicker(html: string): string {
  return html.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (script, open: string, source: string, close: string) =>
      EMBEDDED_PICKER.test(source) ? `${open}${PICKER.trimEnd()}${close}` : script,
  )
}

/**
 * Tells a prototype's picker that the viewer's bottom bar shows its variants (ViewerVariants), so the page draws no bar
 * of its own. Only the viewer sets it: a drop open alone in a window (ViewerPresent) keeps the page's bar.
 */
export const withVariantBar = (document: string) =>
  prependToHead(document, "<script>self.__dropVariantBar = true;</script>")

/**
 * An HTML drop as a Markdown doc's `::drop` box shows it (EMBEDS_SCRIPT in ./documents): no comment layer or error
 * reporter, since the doc around it is what readers review, but storage that works in its opaque origin, Drop's theme
 * when it reads Drop's tokens, and the reader's color mode as a `dark` class on its root either way.
 */
export function embedDocument(html: string, dark: boolean): string {
  const theme = usesDropTheme(html) ? `<style data-drop-theme>${THEME_CSS}</style>` : ""
  return prependToHead(
    html,
    `<script>${OPAQUE_ORIGIN_SHIM}</script>${theme}<script>document.documentElement.classList.toggle("dark", ${dark});</script>`,
  )
}

/**
 * Injects Drop's runtime into a full HTML document. The author's markup stays as it is, except a prototype's picker,
 * which becomes the current one (EMBEDDED_PICKER).
 * `inset`: the room the viewer's floating panel takes on the right at load, so the text starts clear of it.
 * `authored`: a page someone else built (an HTML doc or an app page), which gets only what comments need: Drop's
 * theme only if it reads Drop's tokens, and a comment layer that leaves its clicks alone (ANNOTATOR_SCRIPT).
 */
export function injectRuntime(html: string, dark: boolean, inset = 0, authored = false): string {
  const theme =
    authored && !usesDropTheme(html)
      ? ""
      : `<style data-drop-theme>${THEME_CSS}</style><script>document.documentElement.classList.toggle("dark", ${dark});</script>`
  const head = `<script>${ERROR_REPORTER}</script><script>${EVENT_HOLD}</script><script>${OPAQUE_ORIGIN_SHIM}</script>${theme}<script>document.documentElement.style.setProperty("--drop-inset", "${inset || 0}px");</script>`
  const tail = `<script>${ANNOTATOR_SCRIPT.replace("__COMMENTS_CSS__", () => JSON.stringify(COMMENTS_CSS))
    .replace("__AUTHORED__", String(authored))
    .replace("__THEMED__", String(Boolean(theme)))
    .replace("__DARK__", String(dark))}</script>`
  let out = prependToHead(authored ? upgradePicker(html) : html, head)
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, tail + "</body>") : out + tail
  return out
}
