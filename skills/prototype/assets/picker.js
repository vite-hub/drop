// Drop prototype picker. Drop runs the current copy in every prototype it shows, so a page published to Drop needs none.
// Paste it into a <script> at the end of <body> only for a page opened outside Drop.
// Every top-level <section id="v-…" data-variant="Thing · variation" data-note="One line"> is one item. Two modes:
// - Canvas, the default with two or more items: every item side by side at its real size, `data-width` (px, default
//   1280) by `data-height` (px, default its content). Drag empty space, Space + drag, or middle-drag to pan; Ctrl/⌘ +
//   wheel or pinch to zoom; + and − zoom, Shift+1 fits all, 0 resets the camera. Click a name to copy it; double-click
//   it, press Enter on it, or press 1–9 to open that item in focus. Drag the handle beside a name, or focus it and press
//   the arrow keys, to move the item.
// - Focus: one item fills the page, the same element as on the canvas, so what you typed stays. ← and → step, 1–9
//   jump, Esc or C go back to the canvas, centred on that item.
// `<body data-layout="single">` opens in focus instead. A section with `data-src="https://…"` shows that page live.
// The page remembers the canvas camera and item positions (never content); the URL hash (#v-…) names the item in focus.
// `variantchange` fires on document ({ detail: { id, label, visible } }) whenever the visible set or the current item
// changes: `visible` lists the ids on screen, so an item animates while `visible.includes(its id)`.
// Inside Drop the page draws no bar: Drop's own bottom bar shows the mode and the camera. The page posts its state up
// and takes Drop's commands over postMessage; everything else (keys, hash, memory, the canvas) stays here.
(() => {
  // Drop marks the page before any of its scripts run and injects its own copy; any other copy steps aside.
  const injected = document.currentScript && document.currentScript.hasAttribute("data-drop-picker");
  if ((self.__dropPicker === true && !injected) || self.__dropPickerOn) return;
  self.__dropPickerOn = true;
  const variants = [...document.querySelectorAll("body > [data-variant]")];
  if (!variants.length) return;
  const hosted = self.__dropVariantBar === true && parent !== self;
  const root = document.documentElement;
  const key = "drop-prototype:" + location.pathname;
  const canvasKey = "drop-prototype-canvas:" + location.pathname;
  const remembered = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const find = (id) => (id ? variants.findIndex((el) => el.id === id) : -1);
  const nameOf = (el) => el.dataset.variant || el.id;
  const several = variants.length > 1;

  // A live page as an item: the URL fills its section in a frame. Same-site pages keep the reader's login.
  for (const el of variants) {
    if (!el.dataset.src || el.querySelector(":scope > iframe[data-prototype-src]")) continue;
    let url;
    try { url = new URL(el.dataset.src, location.href); } catch { continue; }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const frame = document.createElement("iframe");
    frame.src = url.href;
    frame.title = nameOf(el);
    frame.setAttribute("data-prototype-src", "");
    frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#fff";
    el.append(frame);
  }

  // A variant's own `display` (an id rule with grid, say) beats the hidden attribute's default style. In the canvas
  // the page stops scrolling and the plane takes its gestures; previews keep their own cursors.
  const css = document.createElement("style");
  css.textContent = `body > [data-variant][hidden] { display: none !important; }
    body > [data-variant][data-src] { padding: 0; }
    html[data-prototype-layout="canvas"], html[data-prototype-layout="canvas"] body { overflow: hidden !important; overscroll-behavior: none !important; height: 100% !important; }
    html[data-prototype-layout="canvas"] body { margin: 0 !important; cursor: default; }
    html[data-prototype-layout="canvas"] body > [data-variant] { cursor: auto; }`;
  document.head.append(css);

  const host = document.createElement("prototype-picker");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    .bar { position: fixed; z-index: 2147483000; bottom: 16px; left: calc((100vw - var(--drop-inset, 0px)) / 2); transform: translateX(-50%);
      display: flex; align-items: center; gap: 2px; max-width: calc(100vw - var(--drop-inset, 0px) - 32px); padding: 4px;
      border: 1px solid rgb(255 255 255 / .12); border-radius: 12px; background: rgb(17 17 17 / .92); color: #fafafa;
      font: 500 12px/1 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / .25); backdrop-filter: blur(8px); }
    button { all: unset; box-sizing: border-box; height: 28px; padding: 0 10px; border-radius: 8px; color: #a3a3a3; cursor: pointer; white-space: nowrap; }
    button:hover { color: #fafafa; background: rgb(255 255 255 / .08); }
    button:focus-visible { outline: 2px solid #fafafa; outline-offset: 1px; }
    .bar > span { padding: 0 8px; color: #a3a3a3; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .bar .current { color: #fafafa; max-width: 28ch; overflow: hidden; text-overflow: ellipsis; }
    .bar .note { max-width: 32ch; overflow: hidden; text-overflow: ellipsis; }
    .bar .zoom { min-width: 5ch; padding: 0; text-align: center; }
    .bar .sep { width: 1px; height: 16px; padding: 0; margin: 0 4px; background: rgb(255 255 255 / .12); }
    .bar:not(.canvas) .cam, .bar.canvas .one { display: none; }
    .tags { display: none; position: fixed; inset: 0 var(--drop-inset, 0px) 0 0; z-index: 2147482000; overflow: hidden; pointer-events: none; }
    .tags.on { display: block; }
    .tag { position: absolute; left: 0; top: 0; display: flex; align-items: center; height: 24px; padding: 0 6px 0 0; pointer-events: auto;
      border: 1px solid rgb(0 0 0 / .08); border-radius: 6px; background: rgb(255 255 255 / .92); color: #171717; box-shadow: 0 1px 2px rgb(0 0 0 / .06);
      font: 500 12px/1 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; overflow: hidden; }
    .tag button { height: 22px; border-radius: 5px; color: inherit; cursor: default; }
    .tag button:hover { background: none; }
    .tag button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
    .tag > * { flex: none; }
    .tag > .name, .tag > .tnote, .tag > .hint, .tag > .done { flex: 0 1 auto; min-width: 0; white-space: nowrap; }
    .tag > .name { flex-shrink: 0; max-width: calc(100% - 44px); }
    .handle, .open { width: 20px; padding: 0; display: grid; place-items: center; color: #a3a3a3 !important; }
    .handle { touch-action: none; }
    .handle:hover, .open:hover { color: #525252 !important; }
    .name { padding: 0 4px; overflow: hidden; text-overflow: ellipsis; user-select: text; -webkit-user-select: text; }
    .name:hover { text-decoration: underline dotted rgb(0 0 0 / .35); text-underline-offset: 3px; }
    .tnote, .hint, .done { color: #737373; overflow: hidden; text-overflow: ellipsis; }
    .tnote { padding-left: 4px; }
    .hint { display: none; padding-left: 4px; }
    .name:hover ~ .hint, .name:focus-visible ~ .hint { display: inline; }
    .name:hover ~ .tnote, .name:focus-visible ~ .tnote, .done:not(:empty) ~ .tnote, .done:not(:empty) ~ .hint { display: none; }
    .done:not(:empty) { padding-left: 4px; color: #15803d; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  </style>
  <nav class="bar" aria-label="Prototype">
    <span class="cam count"></span>
    <i class="cam sep"></i>
    <button class="cam out" aria-label="Zoom out" title="Zoom out (−)">−</button>
    <span class="cam zoom" aria-live="polite">100%</span>
    <button class="cam in" aria-label="Zoom in" title="Zoom in (+)">+</button>
    <button class="cam fit" title="Fit all (Shift+1)">Fit</button>
    <button class="cam reset" title="Reset camera (0)">Reset</button>
    <button class="one prev" aria-label="Previous item" title="Previous (←)">‹</button>
    <span class="one current" aria-live="polite"></span>
    <button class="one next" aria-label="Next item" title="Next (→)">›</button>
    <span class="one note"></span>
    <i class="one sep"></i>
    <button class="one back" title="Every item side by side (Esc)">Canvas</button>
  </nav>
  <div class="tags"></div>
  <p class="sr" id="move-help">Arrow keys move the item, Shift moves it further.</p>`;
  const $ = (s) => shadow.querySelector(s);
  const bar = $(".bar"), tags = $(".tags"), zoomText = $(".zoom"), currentText = $(".current"), noteText = $(".note");
  $(".count").textContent = variants.length + " items";

  // Canvas state. Positions and the camera are in plane pixels; screen = camera + plane × zoom.
  const GAP = 160, MIN_Z = 0.05, MAX_Z = 4, LIMIT = 1e6, URL_HEIGHT = 900;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= LIMIT;
  const size = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? clamp(n, lo, hi) : null; };
  const saved = { camera: null, positions: {} };
  try {
    const doc = JSON.parse(localStorage.getItem(canvasKey) || "null");
    if (doc && doc.v === 1) {
      const c = doc.camera;
      if (c && finite(c.x) && finite(c.y) && finite(c.z) && c.z >= MIN_Z && c.z <= MAX_Z) saved.camera = { x: c.x, y: c.y, z: c.z };
      const ids = new Set(variants.map((el) => el.id));
      for (const [id, p] of Object.entries(doc.positions || {})) if (ids.has(id) && Array.isArray(p) && finite(p[0]) && finite(p[1])) saved.positions[id] = [p[0], p[1]];
    }
  } catch {}

  const items = variants.map((el, i) => {
    const width = size(el.dataset.width, 120, 8000), height = size(el.dataset.height, 80, 8000), src = Boolean(el.querySelector(":scope > iframe[data-prototype-src]"));
    const it = { el, i, name: nameOf(el), width, height, src, w: width || 1280, h: height || (src ? URL_HEIGHT : null), mw: 0, mh: 0, authored: el.getAttribute("style") };
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.innerHTML = `<button class="handle" aria-describedby="move-help"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.4"/><circle cx="8" cy="2" r="1.4"/><circle cx="2" cy="7" r="1.4"/><circle cx="8" cy="7" r="1.4"/><circle cx="2" cy="12" r="1.4"/><circle cx="8" cy="12" r="1.4"/></svg></button><button class="name"></button><button class="open"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M7 1.5h3.5V5M5 10.5H1.5V7M10.5 1.5 7 5M1.5 10.5 5 7"/></svg></button><span class="done" role="status"></span><span class="hint">Click to copy · double-click to open</span><span class="tnote"></span>`;
    const handle = tag.querySelector(".handle"), name = tag.querySelector(".name"), open = tag.querySelector(".open"), done = tag.querySelector(".done");
    handle.setAttribute("aria-label", "Move " + it.name);
    open.setAttribute("aria-label", "Open " + it.name);
    open.title = "Open (" + (i < 9 ? i + 1 : "double-click the name") + ")";
    name.textContent = it.name;
    name.title = "Copy “" + it.name + "”";
    tag.querySelector(".tnote").textContent = el.dataset.note || "";
    it.tag = tag;
    let timer = 0;
    name.onclick = async () => {
      clearTimeout(timer);
      try {
        // Drop's frame may not write to the clipboard, so Drop copies the name (and says so if it can't).
        if (hosted) parent.postMessage({ __drop: true, type: "copy", text: it.name }, "*");
        else await navigator.clipboard.writeText(it.name);
        done.textContent = "Copied";
      } catch {
        try { getSelection().selectAllChildren(name); } catch {}
        done.textContent = "Select the name and copy it";
      }
      timer = setTimeout(() => { done.textContent = ""; }, 1600);
    };
    name.ondblclick = () => toFocus(i);
    open.onclick = () => toFocus(i);
    // Enter opens; Space still copies, as the button's own key.
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); toFocus(i); } });
    handle.addEventListener("pointerdown", (e) => {
      if (gesture || e.button !== 0) return;
      e.preventDefault();
      handle.focus();
      try { handle.setPointerCapture(e.pointerId); } catch {}
      gesture = { kind: "move", id: e.pointerId, it, x: e.clientX, y: e.clientY, moved: false };
    });
    handle.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 64 : 8;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      place(it, it.x + d[0], it.y + d[1]);
      settle();
    });
    tags.append(tag);
    return it;
  });
  // Saved positions first; new items go in the empty space to the right of the rest.
  let right = -Infinity;
  for (const it of items) {
    const p = saved.positions[it.el.id];
    if (p) { [it.x, it.y] = p; right = Math.max(right, it.x + it.w); }
  }
  for (const it of items) {
    if (saved.positions[it.el.id]) continue;
    it.x = right === -Infinity ? 0 : right + GAP;
    it.y = 0;
    right = it.x + it.w;
  }
  const place = (it, x, y) => { it.x = clamp(x, -LIMIT, LIMIT); it.y = clamp(y, -LIMIT, LIMIT); schedule(); };

  let mode = "", current = -1, gesture = null, space = false, frame = 0, settleTimer = 0, touched = false, suppressUntil = 0;
  let synced = false, reportedZoom = 0;
  const cam = saved.camera ? { ...saved.camera } : { x: 48, y: 64, z: 1 };
  const inset = () => parseFloat(getComputedStyle(root).getPropertyValue("--drop-inset")) || 0;
  const view = () => ({ w: Math.max(1, innerWidth - inset()), h: Math.max(1, innerHeight) });

  // One transform write per item per frame; previews never re-render for the camera. Labels stay at screen size.
  function render() {
    frame = 0;
    if (mode !== "canvas") return;
    for (const it of items) {
      const sx = cam.x + it.x * cam.z, sy = cam.y + it.y * cam.z;
      it.el.style.setProperty("transform", `translate(${sx}px, ${sy}px) scale(${cam.z})`, "important");
      it.tag.style.transform = `translate(${sx}px, ${sy - 30}px)`;
      it.tag.style.maxWidth = Math.max(it.w * cam.z, 76) + "px";
    }
    const zoom = Math.round(cam.z * 100);
    zoomText.textContent = zoom + "%";
    if (zoom !== reportedZoom) report();
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  const bound = () => { cam.z = clamp(cam.z, MIN_Z, MAX_Z); cam.x = clamp(cam.x, -LIMIT, LIMIT); cam.y = clamp(cam.y, -LIMIT, LIMIT); };
  // After a gesture: save, and let Drop's comment pins measure their anchors again.
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settleTimer = 0; save(); window.dispatchEvent(new Event("resize")); }, 160);
  }
  function save() {
    const positions = {};
    for (const it of items) positions[it.el.id] = [Math.round(it.x), Math.round(it.y)];
    const doc = { v: 1, camera: mode === "canvas" || saved.camera ? { x: Math.round(cam.x * 100) / 100, y: Math.round(cam.y * 100) / 100, z: Math.round(cam.z * 1e4) / 1e4 } : null, positions };
    try { localStorage.setItem(canvasKey, JSON.stringify(doc)); } catch {}
  }
  function zoomAt(z, px, py) {
    z = clamp(z, MIN_Z, MAX_Z);
    const wx = (px - cam.x) / cam.z, wy = (py - cam.y) / cam.z;
    cam.z = z; cam.x = px - wx * z; cam.y = py - wy * z;
    touched = true; bound(); schedule(); settle();
  }
  const zoomCenter = (f) => { const v = view(); zoomAt(cam.z * f, v.w / 2, v.h / 2); };
  const box = (it) => ({ x: it.x, y: it.y, w: it.mw || it.w, h: it.mh || it.h || 1 });
  // Fits the given items between the top labels and the bottom bar, at 100% or less.
  function fit(list = items) {
    const v = view(), top = 56, bottom = 72, side = 32;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of list) { const b = box(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    if (!Number.isFinite(x0)) return;
    const z = clamp(Math.min((v.w - side * 2) / (x1 - x0), (v.h - top - bottom) / (y1 - y0), 1), MIN_Z, MAX_Z);
    cam.z = z;
    cam.x = (v.w - (x1 - x0) * z) / 2 - x0 * z;
    cam.y = top + Math.max(0, (v.h - top - bottom - (y1 - y0) * z) / 2) - y0 * z;
    bound(); schedule(); settle();
  }
  function reset() { cam.x = 48; cam.y = 64; cam.z = 1; touched = true; schedule(); settle(); }
  // Centres an item at the current zoom, or fits it when it's bigger than the screen.
  function reveal(it) {
    const v = view(), b = box(it);
    if (b.w * cam.z > v.w - 64 || b.h * cam.z > v.h - 128) return fit([it]);
    cam.x = (v.w - b.w * cam.z) / 2 - b.x * cam.z;
    cam.y = Math.max(56, (v.h - 72 - b.h * cam.z) / 2) - b.y * cam.z;
    bound(); schedule(); settle();
  }
  const sizes = new ResizeObserver(() => {
    for (const it of items) { if (it.el.offsetWidth) it.mw = it.el.offsetWidth; if (it.el.offsetHeight) it.mh = it.el.offsetHeight; }
  });

  // Every switch starts from the author's own style attribute, so nothing from the other mode lingers.
  const restore = (it) => { if (it.authored == null) it.el.removeAttribute("style"); else it.el.setAttribute("style", it.authored); };
  const set = (el, props) => { for (const [p, val] of props) el.style.setProperty(p, val, "important"); };

  function toCanvas() {
    if (mode === "canvas") return;
    const from = mode === "focus" ? items[current] : null;
    mode = "canvas";
    root.dataset.prototypeLayout = "canvas";
    for (const it of items) {
      restore(it);
      it.el.hidden = false;
      set(it.el, [["position", "absolute"], ["left", "0"], ["top", "0"], ["margin", "0"], ["width", it.w + "px"], ["max-width", "none"],
        ["min-width", "0"], ["box-sizing", "border-box"], ["transform-origin", "0 0"], ["box-shadow", "0 0 0 1px rgb(127 127 127 / .22)"]]);
      if (it.h) set(it.el, [["height", it.h + "px"], ["overflow", it.src ? "hidden" : "auto"]]);
      sizes.observe(it.el);
    }
    scrollTo(0, 0);
    tags.classList.add("on");
    bar.classList.add("canvas");
    schedule();
    // Coming back from focus centres that item; the first visit fits everything, unless a camera is saved.
    const go = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (mode !== "canvas") return;
      if (from) reveal(from);
      else if (!saved.camera && !touched) fit();
    }));
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(go, go);
    hash(null);
    window.dispatchEvent(new Event("resize"));
    announce();
    save();
  }

  function toFocus(i) {
    i = (i + variants.length) % variants.length;
    if (mode === "focus" && i === current) return;
    if (mode === "canvas") {
      saved.camera = { ...cam };
      for (const it of items) sizes.unobserve(it.el);
      delete root.dataset.prototypeLayout;
      tags.classList.remove("on");
      bar.classList.remove("canvas");
    }
    mode = "focus";
    current = i;
    for (const it of items) {
      restore(it);
      it.el.hidden = it.i !== i;
    }
    // The item at its real size: its declared width (never wider than the page), its declared height, or a live page
    // filling the screen.
    const it = items[i];
    if (it.width) set(it.el, [["width", it.width + "px"], ["max-width", "100%"], ["margin-inline", "auto"], ["box-sizing", "border-box"]]);
    if (it.height || it.src) set(it.el, [["height", it.height ? it.height + "px" : "100vh"], ["overflow", it.src ? "hidden" : "auto"]]);
    scrollTo(0, 0);
    currentText.textContent = `${it.name} (${i + 1}/${variants.length})`;
    noteText.textContent = it.el.dataset.note || "";
    noteText.title = it.el.dataset.note || "";
    noteText.hidden = !it.el.dataset.note;
    try { localStorage.setItem(key, it.el.id); } catch {}
    hash(it.el.id);
    // Comment pins measure their anchors on resize, so they follow the item that just appeared.
    window.dispatchEvent(new Event("resize"));
    announce();
  }

  // The hash names the item in focus; the canvas has none.
  function hash(id) {
    try {
      if (id) history.replaceState(history.state, "", "#" + id);
      else if (find(location.hash.slice(1)) >= 0) history.replaceState(history.state, "", location.pathname + location.search);
    } catch {}
  }

  function announce() {
    const el = variants[Math.max(current, 0)];
    const visible = mode === "canvas" ? variants.map((v) => v.id) : [el.id];
    document.dispatchEvent(new CustomEvent("variantchange", { detail: { id: el.id, label: nameOf(el), visible } }));
    report();
  }

  // Drop asks for the state once its bar is ready for this page (sync), then hears every change.
  function report() {
    if (!hosted || !synced || !several) return;
    reportedZoom = Math.round(cam.z * 100);
    const list = variants.map((el) => ({ id: el.id, label: nameOf(el), note: el.dataset.note || "" }));
    parent.postMessage({ __drop: true, type: "variants", variants: list, current: Math.max(current, 0), canvas: mode === "canvas", zoom: reportedZoom }, "*");
  }
  const commands = {
    sync: () => { synced = true; report(); },
    show: (m) => Number.isInteger(m.index) && m.index >= 0 && m.index < variants.length && toFocus(m.index),
    prev: () => mode === "focus" && toFocus(current - 1),
    next: () => mode === "focus" && toFocus(current + 1),
    canvas: () => toCanvas(),
    "zoom-in": () => mode === "canvas" && zoomCenter(1.25),
    "zoom-out": () => mode === "canvas" && zoomCenter(1 / 1.25),
    fit: () => mode === "canvas" && fit(),
    reset: () => mode === "canvas" && reset(),
  };
  if (hosted) window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.__drop !== true || m.type !== "picker" || !Object.hasOwn(commands, m.do)) return;
    commands[m.do](m);
  });

  $(".prev").onclick = () => toFocus(current - 1);
  $(".next").onclick = () => toFocus(current + 1);
  $(".back").onclick = toCanvas;
  $(".out").onclick = () => zoomCenter(1 / 1.25);
  $(".in").onclick = () => zoomCenter(1.25);
  $(".fit").onclick = () => fit();
  $(".reset").onclick = reset;
  window.addEventListener("hashchange", () => { const i = find(location.hash.slice(1)); if (i >= 0) toFocus(i); });

  const typing = (t) => t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
  const interactive = (t) => t === host || typing(t) || (t && t.closest && t.closest("a[href], button, summary, [tabindex], [contenteditable]"));
  const digit = (e) => /^[1-9]$/.test(e.key) && Number(e.key) <= variants.length;
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(t) || !several) return;
    // With text selected, C is Drop's: it comments on the selection.
    if ((e.key === "c" || e.key === "C") && !String(getSelection() || "")) { if (mode === "canvas") toFocus(Math.max(current, 0)); else toCanvas(); e.preventDefault(); return; }
    if (mode === "canvas") {
      // Shadow controls (handles, names, the bar) keep their own keys; the plane takes the rest.
      if (t === host) return;
      if (e.key === " ") { if (interactive(t)) return; space = true; e.preventDefault(); return; }
      if (interactive(t) && t !== document.body) return;
      const pan = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[e.key];
      if (pan) { cam.x += pan[0]; cam.y += pan[1]; touched = true; bound(); schedule(); settle(); }
      else if (e.key === "+" || e.key === "=") zoomCenter(1.25);
      else if (e.key === "-" || e.key === "_") zoomCenter(1 / 1.25);
      else if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) fit();
      else if (e.key === "0") reset();
      else if (digit(e)) toFocus(Number(e.key) - 1);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") toCanvas();
    else if (e.key === "ArrowLeft") toFocus(current - 1);
    else if (e.key === "ArrowRight") toFocus(current + 1);
    else if (digit(e)) toFocus(Number(e.key) - 1);
    else return;
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { if (e.key === " ") space = false; });

  // Gestures. Space + drag and middle-drag pan anywhere and win over everything else; a plain drag pans only from
  // empty space, so previews keep their clicks, selection, and inputs.
  function endGesture() {
    if (!gesture) return;
    if (gesture.moved) suppressUntil = performance.now() + 400;
    gesture = null;
    settle();
  }
  window.addEventListener("pointerdown", (e) => {
    if (mode !== "canvas" || gesture) return;
    const empty = e.target === root || e.target === document.body;
    if (!(e.button === 1 || (e.button === 0 && (space || (empty && e.pointerType === "mouse"))))) return;
    e.preventDefault();
    e.stopPropagation();
    try { root.setPointerCapture(e.pointerId); } catch {}
    gesture = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }, true);
  window.addEventListener("pointermove", (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    gesture.x = e.clientX; gesture.y = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 0) gesture.moved = true;
    if (gesture.kind === "pan") { cam.x += dx; cam.y += dy; touched = true; bound(); schedule(); }
    else place(gesture.it, gesture.it.x + dx / cam.z, gesture.it.y + dy / cam.z);
  }, true);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) window.addEventListener(type, (e) => { if (gesture && e.pointerId === gesture.id) endGesture(); }, true);
  // After a pan or a move, the release doesn't click, copy, follow a link, or start middle-click autoscroll.
  for (const type of ["click", "auxclick"]) window.addEventListener(type, (e) => {
    if (performance.now() < suppressUntil) { suppressUntil = 0; e.preventDefault(); e.stopPropagation(); }
  }, true);
  const drop = () => { space = false; endGesture(); };
  window.addEventListener("blur", drop);
  document.addEventListener("visibilitychange", () => { if (document.hidden) drop(); });

  // A nested scroller that can still scroll in the wheel's direction keeps the wheel; otherwise the plane pans.
  function scrolls(t, dx, dy) {
    for (let el = t; el && el !== document.body && el !== root; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (dy && /auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1 && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)) return true;
      if (dx && /auto|scroll/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1 && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0)) return true;
    }
    return false;
  }
  window.addEventListener("wheel", (e) => {
    if (mode !== "canvas" || e.composedPath().includes(bar)) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(cam.z * Math.exp(-clamp(dy, -30, 30) / 100), e.clientX, e.clientY); return; }
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    if (scrolls(e.target, dx, dy)) return;
    e.preventDefault();
    cam.x -= dx; cam.y -= dy; touched = true; bound(); schedule(); settle();
  }, { passive: false, capture: true });
  // Safari reports trackpad pinch as gesture events.
  let pinchFrom = 1;
  window.addEventListener("gesturestart", (e) => { if (mode === "canvas") { e.preventDefault(); pinchFrom = cam.z; } });
  window.addEventListener("gesturechange", (e) => { if (mode === "canvas") { e.preventDefault(); zoomAt(pinchFrom * e.scale, e.clientX, e.clientY); } });

  // The page never scrolls under the plane; focus that lands off screen moves the camera instead.
  const unscroll = () => {
    if (mode !== "canvas") return;
    if (scrollX || scrollY) scrollTo(0, 0);
    if (document.body.scrollTop || document.body.scrollLeft) document.body.scrollTop = document.body.scrollLeft = 0;
  };
  window.addEventListener("scroll", unscroll, true);
  document.addEventListener("focusin", (e) => {
    if (mode !== "canvas" || !(e.target instanceof Element) || e.target === host) return;
    unscroll();
    const at = items.findIndex((it) => it.el.contains(e.target));
    if (at >= 0) current = at;
    const r = e.target.getBoundingClientRect(), v = view();
    let dx = 0, dy = 0;
    if (r.right > v.w - 24) dx = v.w - 24 - r.right;
    if (r.left + dx < 24) dx = 24 - r.left;
    if (r.bottom > v.h - 80) dy = v.h - 80 - r.bottom;
    if (r.top + dy < 56) dy = 56 - r.top;
    if (dx || dy) { cam.x += dx; cam.y += dy; bound(); schedule(); settle(); }
  });
  window.addEventListener("resize", schedule);
  window.addEventListener("pagehide", () => { if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; save(); } });

  if (hosted || !several) bar.remove();
  document.body.append(host);
  // A hash names an item to open in focus; otherwise two or more items open on the canvas.
  const named = find(location.hash.slice(1));
  current = Math.max(find(remembered()), 0);
  if (named >= 0) toFocus(named);
  else if (!several || /^(single|picker)$/.test(document.body.dataset.layout || "")) toFocus(current);
  else toCanvas();
})();
