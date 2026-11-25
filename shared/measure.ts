export const MEASURE = String.raw`/**
   * Measure, one piece for a drop's own frame (plan-runtime.ts) and a live site through review.js (review-script.ts).
   * measureTool(fx, edge) draws into fx, a layer of fixed boxes over the page in the caller's shadow root, styled by
   * MEASURE_CSS with the hues from measureColors. draw(picked, over) shows the element's size and box model, its type
   * and colors, and, once one is picked, the distances from it to the one the pointer is over; the caller clears fx
   * first. edge() is how far from the top left the card keeps (the rulers' width while they show). The card is 15rem
   * unless --measure-card says otherwise, since on a site rem is the site's. px and tag are the labels' own.
   */
  function measureTool(fx, edge) {
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
      card.style.left = Math.max(edge() + 8, Math.min(innerWidth - w - 8, r.left)) + "px";
      card.style.top = Math.max(edge() + 8, top) + "px";
    }

    function draw(picked, over) {
      if (picked) boxModel(picked);
      else if (over) boxModel(over);
      const a = picked && outline(picked, true), b = over && outline(over);
      if (a && b) distances(a, b);
      const sized = a || b;
      if (sized && !(a && b)) tag(px(sized.width) + " × " + px(sized.height), sized.left + sized.width / 2, sized.bottom + 6, "", true);
      if (picked || over) infoCard(picked || over);
    }
    return { draw, px, tag };
  }`

export const MEASURE_CSS =
  ".fx>*{position:fixed;box-sizing:border-box;pointer-events:none}.hl{outline:1.5px solid var(--hi);outline-offset:-.75px}.hl.sel{outline-width:2px;background:color-mix(in oklab,var(--hi) 8%,transparent)}" +
  ".mb{background:rgb(246 178 107/.35)}.pb{background:rgb(147 196 125/.4)}.ln{background:var(--gd)}.ln.dash{background:none;border:0 dashed var(--gd)}" +
  ".tag{padding:2px 4px;border-radius:4px;background:var(--hi-fill);color:#fff;font:500 10px/14px ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}.tag.d{background:var(--gd-fill)}" +
  ".card{width:var(--measure-card,15rem);box-sizing:border-box;padding:8px;border:1px solid transparent;border-radius:8px;background:var(--sf);color:var(--ink);font:11px/16px ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;box-shadow:var(--float)}" +
  ".card b{display:block;margin-bottom:6px;font:500 11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".card div{display:flex;justify-content:space-between;gap:12px}.card span:first-child{color:var(--ink-muted)}.card span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".sw{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:3px;vertical-align:-1px;box-shadow:inset 0 0 0 1px rgb(128 128 128/.35)}"

export const measureColors = (dark: boolean) =>
  "--hi:oklch(0.62 0.18 255);--hi-fill:oklch(0.56 0.18 255);--gd:oklch(0.63 0.26 29.23);--gd-fill:oklch(0.58 0.22 29.23);" +
  (dark
    ? "--sf:#18181b;--ink:#fafafa;--ink-muted:#a1a1aa;--tick:#52525b;--float:0 0 0 .5px rgb(255 255 255/.16),0 1px 1px rgb(0 0 0/.125),0 2px 5px rgb(0 0 0/.125),0 3px 8px rgb(0 0 0/.125)"
    : "--sf:#fff;--ink:#18181b;--ink-muted:#71717a;--tick:#cbd5e1;--float:0 0 0 .5px rgb(0 0 0/.18),0 1px 1px rgb(0 0 0/.06),0 3px 9px rgb(0 0 0/.06),0 6px 18px rgb(0 0 0/.03)")
