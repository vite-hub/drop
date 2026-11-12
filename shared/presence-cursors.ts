/**
 * Live cursors, as script and style text for the two places that draw on someone else's page: the comment layer in a
 * drop's frame (./plan-runtime) and the review script on a reviewed site (./review-script). Both run it next to
 * ELEMENT_NAMING, whose `pathOf` names elements.
 *
 * A cursor is where a person's pointer is, said the way ViteHub's comments overlay says it: the element under the pointer
 * (`selector`) and the spot inside it in thousandths of its box (`x`, `y`). Readers have different widths, so a raw
 * x and y would land on the wrong word; an element and a spot in it survive the page reflowing.
 *
 * `mountCursors(root, under)` draws other people's cursors in `root` (in the script's shadow root) and names the spot
 * under a point with `anchorAt`; `under(x, y)` is the element at a point, past the script's own elements. `set` takes
 * the cursors to show; each one's label fades after it stays still for a while, and the cursor itself hides while its
 * element is off screen or gone.
 */
export const PRESENCE_CURSORS = String.raw`function mountCursors(root, under) {
    const STILL_MS = 3000;
    const layer = document.createElement("div");
    layer.className = "pcs";
    layer.setAttribute("aria-hidden", "true");
    // First in the root, so the script's own pins and toolbar paint over cursors.
    root.prepend(layer);
    const nodes = new Map(), moved = new Map();
    let list = [], frame = 0, stillTimer = 0;

    function anchorAt(x, y) {
      const el = under(x, y);
      if (!el || el === document.documentElement) return null;
      const r = el.getBoundingClientRect();
      return { selector: pathOf(el), x: r.width ? Math.round(((x - r.left) / r.width) * 1000) : 0, y: r.height ? Math.round(((y - r.top) / r.height) * 1000) : 0 };
    }
    // White or near-black, whichever reads better on the person's color (WCAG relative luminance).
    function inkOn(color) {
      const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
      if (!m) return "#fff";
      const [r, g, b] = m.slice(1).map((h) => { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? "#0a0a0a" : "#fff";
    }
    function place() {
      frame = 0;
      for (const cursor of list) {
        const node = nodes.get(cursor.key);
        let target = null;
        try { target = document.querySelector(cursor.selector); } catch {}
        if (!target) { node.classList.add("off"); continue; }
        const r = target.getBoundingClientRect(), x = r.left + (cursor.x / 1000) * r.width, y = r.top + (cursor.y / 1000) * r.height;
        node.classList.toggle("off", x < -16 || y < -16 || x > innerWidth + 16 || y > innerHeight + 16);
        node.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    addEventListener("scroll", schedule, { capture: true, passive: true });
    addEventListener("resize", schedule);
    function markStill() {
      clearTimeout(stillTimer);
      const now = Date.now();
      let next = Infinity;
      for (const [key, at] of moved) {
        const still = now - at.t >= STILL_MS;
        nodes.get(key)?.classList.toggle("still", still);
        if (!still) next = Math.min(next, at.t + STILL_MS - now);
      }
      if (next !== Infinity) stillTimer = setTimeout(markStill, next + 20);
    }
    function set(next) {
      const keys = new Set(next.map((cursor) => cursor.key));
      for (const [key, node] of nodes) if (!keys.has(key)) { node.remove(); nodes.delete(key); moved.delete(key); }
      for (const cursor of next) {
        let node = nodes.get(cursor.key);
        if (!node) {
          node = document.createElement("div");
          node.className = "pc new";
          node.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 1.5 14 6.6 8.3 8.3 6.6 14z"/></svg><span></span>';
          layer.append(node);
          nodes.set(cursor.key, node);
        }
        node.style.setProperty("--pc", cursor.color);
        node.style.setProperty("--pc-ink", inkOn(cursor.color));
        node.lastChild.textContent = cursor.name;
        const at = cursor.selector + " " + cursor.x + " " + cursor.y, was = moved.get(cursor.key);
        if (!was || was.at !== at) moved.set(cursor.key, { at, t: Date.now() });
      }
      list = next;
      place();
      markStill();
      // A new cursor starts where it is: it fades in, and only glides from its next move on.
      requestAnimationFrame(() => { for (const node of nodes.values()) node.classList.remove("new"); });
    }
    return { anchorAt, set };
  }`

/**
 * The cursors' look: the person's color for the arrow and the name tag, a 1px ring that keeps both visible on any page,
 * and moves that glide over one update (presence updates come every 50 ms or so), interrupted by the next one. Under
 * reduced motion they jump instead. Nothing here takes a click.
 */
export const PRESENCE_CURSOR_STYLE =
  ".pcs{position:fixed;inset:0;overflow:hidden;pointer-events:none}" +
  ".pc{position:absolute;left:0;top:0;display:flex;align-items:flex-start;gap:2px;transition:transform 80ms linear,opacity 200ms ease;will-change:transform}" +
  ".pc svg{flex:none;display:block;fill:var(--pc);stroke:#fff;stroke-width:1.25;stroke-linejoin:round;filter:drop-shadow(0 1px 1px rgb(0 0 0/.3))}" +
  ".pc span{margin-top:12px;max-width:160px;padding:2px 6px;border-radius:4px 8px 8px 8px;background:var(--pc);color:var(--pc-ink);font:600 11px/16px ui-sans-serif,system-ui,-apple-system,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgb(0 0 0/.2);transition:opacity 200ms ease}" +
  ".pc.still span{opacity:0}.pc.off{opacity:0}.pc.new{transition:opacity 200ms ease;opacity:0}" +
  "@media (prefers-reduced-motion:reduce){.pc{transition:opacity 200ms ease}}"
