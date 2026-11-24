// Drop prototype picker. Drop runs the current copy in every prototype it shows, so a page published to Drop needs none.
// Paste it into a <script> at the end of <body> only for a page opened outside Drop.
// Every top-level <section id="v-…" data-variant="Thing · variation" data-note="One line"> is one item. Two modes:
// - Canvas, the default with two or more items: every item side by side at its real size, `data-width` (px, default
//   1280) by `data-height` (px, default its content). Drag empty space, hold Space and drag, or middle-drag to pan;
//   the Hand tool (H, V for Move again) pans from anywhere, over the items too, as in Figma. Ctrl/⌘ + wheel or pinch
//   to zoom; + and − zoom, Shift+1 fits all, 0 resets the camera. Click a name to copy it; double-click
//   it, press Enter on it, or press 1–9 to open that item in focus. Drag the handle beside a name, or focus it and press
//   the arrow keys, to move the item. The camera stops where an item would leave the screen (a fence), and a minimap in
//   the bottom-right corner shows the items and the screen: click it to jump, drag the screen's box to move.
// - Focus: one item fills the page, the same element as on the canvas, so what you typed stays. ← and → step, 1–9
//   jump, Esc or C go back to the canvas, centred on that item.
// `<body data-layout="single">` opens in focus instead. A section with `data-src="https://…"` shows that page live: it
// loads once the item comes near the screen, two at a time, and sleeps (empty, its name shown) after a while far away.
// In an item, a control with `data-go="<screen id>"` and `data-label` gets an arrow from it to that `[data-screen]`.
// `data-x` and `data-y` (plane px) on an item place it on the canvas; items without them follow in rows to the right,
// a new row once one passes 5600px. The page remembers the canvas camera and where the reader moved items (never
// content); Reset layout forgets the moves. ⌘Z or Ctrl+Z takes back a move or a Reset layout, ⇧⌘Z or Ctrl+Y redoes it.
// The URL hash (#v-…) names the item in focus.
// Inside Drop the camera is remembered per version: a new version opens fitted.
// `variantchange` fires on document ({ detail: { id, label, visible } }) whenever the visible set or the current item
// changes: `visible` lists the ids on screen, so an item animates while `visible.includes(its id)`. `canvasmove` fires
// on document each frame the camera or an item moves.
// Inside Drop the page draws no bar: Drop's own bottom bar shows the mode, the tool, and the camera. The page posts its state up
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

  // A live page as an item: the URL fills its section in a frame. Same-site pages keep the reader's login. The frame
  // starts empty and gets its URL once the item comes near the screen (rest).
  const lives = new Map();
  for (const el of variants) {
    if (!el.dataset.src || el.querySelector(":scope > iframe[data-prototype-src]")) continue;
    let url;
    try { url = new URL(el.dataset.src, location.href); } catch { continue; }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const live = { url: url.href, frame: null, state: "asleep", timer: 0, slow: 0 };
    lives.set(el, live);
    blank(el, live);
  }
  // An empty frame holds the item's place. Each sleep makes a new one, so a page that goes leaves no history entry.
  function blank(el, live) {
    const frame = document.createElement("iframe");
    frame.title = nameOf(el);
    frame.setAttribute("data-prototype-src", "");
    frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#fff";
    if (live.frame) live.frame.replaceWith(frame);
    else el.append(frame);
    live.frame = frame;
    el.setAttribute("data-prototype-asleep", "");
  }

  // A variant's own `display` (an id rule with grid, say) beats the hidden attribute's default style. In the canvas
  // the page stops scrolling and the plane takes its gestures; previews keep their own cursors.
  const css = document.createElement("style");
  css.textContent = `body > [data-variant][hidden] { display: none !important; }
    body > [data-variant][data-src] { padding: 0; }
    body > [data-variant][data-prototype-asleep] { position: relative; }
    body > [data-variant][data-prototype-asleep]::after { content: attr(data-variant); position: absolute; inset: 0; display: grid; place-items: center; padding: 16px;
      background: #f5f5f5; color: #737373; font: 500 14px/1.4 ui-sans-serif, system-ui, sans-serif; text-align: center; pointer-events: none; }
    body > [data-variant][data-prototype-stalled]::after { padding-block: 0 40px; }
    body > [data-variant] > [data-prototype-retry] { position: absolute; z-index: 1; top: 50%; left: 50%; transform: translateX(-50%);
      border: 1px solid #737373; border-radius: 6px; padding: 4px 8px; background: #fff; color: #171717;
      font: 500 14px/1.4 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    html[data-prototype-layout="canvas"], html[data-prototype-layout="canvas"] body { overflow: hidden !important; overscroll-behavior: none !important; height: 100% !important; }
    html[data-prototype-layout="canvas"] body { margin: 0 !important; cursor: default; }
    html[data-prototype-layout="canvas"] body > [data-variant] { cursor: auto; }
    html[data-prototype-hand], html[data-prototype-hand] body { cursor: grab !important; }
    html[data-prototype-hand="grabbing"], html[data-prototype-hand="grabbing"] body { cursor: grabbing !important; }`;
  document.head.append(css);

  const host = document.createElement("prototype-picker");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    .bar { position: fixed; z-index: 2147483000; bottom: 16px; left: calc((100vw - var(--drop-inset, 0px)) / 2); transform: translateX(-50%);
      display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px; max-width: calc(100vw - var(--drop-inset, 0px) - 32px); padding: 4px;
      border: 1px solid rgb(255 255 255 / .12); border-radius: 12px; background: rgb(17 17 17 / .92); color: #fafafa;
      font: 500 12px/1 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / .25); backdrop-filter: blur(8px); }
    button { all: unset; box-sizing: border-box; height: 28px; padding: 0 10px; border-radius: 8px; color: #a3a3a3; cursor: pointer; white-space: nowrap; }
    button:hover { color: #fafafa; background: rgb(255 255 255 / .08); }
    button[aria-pressed="true"] { color: #171717; background: #fafafa; }
    button:focus-visible { outline: 2px solid #fafafa; outline-offset: 1px; }
    .bar > span { padding: 0 8px; color: #a3a3a3; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .bar .current { color: #fafafa; max-width: 44ch; overflow: hidden; text-overflow: ellipsis; }
    .bar .note { max-width: 64ch; overflow: hidden; text-overflow: ellipsis; }
    .bar .zoom { min-width: 5ch; padding: 0; text-align: center; }
    .bar .sep { width: 1px; height: 16px; padding: 0; margin: 0 4px; background: rgb(255 255 255 / .12); }
    .bar:not(.canvas) .cam, .bar.canvas .one { display: none; }
    .tags { display: none; position: fixed; inset: 0 var(--drop-inset, 0px) 0 0; z-index: 2147482000; overflow: hidden; pointer-events: none; }
    .tags.on { display: block; }
    .shield { position: absolute; inset: 0; display: none; cursor: grab; touch-action: none; }
    .tags.hand .shield { display: block; pointer-events: auto; }
    .tags.hand .tag { pointer-events: none; }
    .tags.grabbing .shield { cursor: grabbing; }
    .tag { position: absolute; left: 0; top: 0; display: grid; grid-template-columns: 20px minmax(0, 1fr) 20px; align-items: center; min-height: 22px; pointer-events: auto;
      color: #171717; font: 500 12px/1 ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
    .tag button { height: 22px; border-radius: 5px; color: inherit; cursor: default; }
    .tag button:hover { background: none; }
    .tag button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
    .tag > .name, .tag > .tnote { min-width: 0; white-space: nowrap; }
    .tag > .tnote { box-sizing: border-box; grid-column: 1 / -1; width: 100%; padding: 2px 0 0 24px; white-space: normal; overflow-wrap: anywhere; line-height: 1.35; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .tag > .tnote:empty, .tag.narrow > .tnote { display: none; }
    .handle, .open { width: 20px; padding: 0; display: grid; place-items: center; color: #a3a3a3 !important; }
    .handle { touch-action: none; opacity: 0; }
    .tag:hover .handle, .handle:focus-visible { opacity: 1; }
    .handle:hover, .open:hover { color: #525252 !important; }
    .name { padding: 0 4px; overflow: hidden; text-overflow: ellipsis; user-select: text; -webkit-user-select: text; }
    .name:hover { text-decoration: underline dotted rgb(0 0 0 / .35); text-underline-offset: 3px; }
    .tnote { color: #737373; overflow: hidden; text-overflow: ellipsis; }
    .done:not(:empty) { position: absolute; top: 0; right: 0; height: 22px; padding: 0 2px 0 8px; display: grid; align-items: center; background: #fff; color: #15803d; white-space: nowrap; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .map { position: absolute; right: 12px; bottom: 12px; width: 160px; height: 104px; box-sizing: border-box; pointer-events: auto; cursor: pointer; touch-action: none;
      border: 1px solid #e5e5e5; border-radius: 10px; background: #fff; box-shadow: 0 4px 16px rgb(0 0 0 / .08); overflow: hidden; }
    .map canvas { display: block; width: 100%; height: 100%; }
    .edge { position: absolute; pointer-events: none; opacity: 0; }
    .edge.fade { transition: opacity .35s ease-out; }
    .edge.l { left: 0; top: 0; bottom: 0; width: 28px; border-left: 2px solid #2563eb; background: linear-gradient(90deg, rgb(37 99 235 / .3), transparent); }
    .edge.r { right: 0; top: 0; bottom: 0; width: 28px; border-right: 2px solid #2563eb; background: linear-gradient(270deg, rgb(37 99 235 / .3), transparent); }
    .edge.t { top: 0; left: 0; right: 0; height: 28px; border-top: 2px solid #2563eb; background: linear-gradient(180deg, rgb(37 99 235 / .3), transparent); }
    .edge.b { bottom: 0; left: 0; right: 0; height: 28px; border-bottom: 2px solid #2563eb; background: linear-gradient(0deg, rgb(37 99 235 / .3), transparent); }
  </style>
  <nav class="bar" aria-label="Prototype">
    <span class="cam count"></span>
    <i class="cam sep"></i>
    <button class="cam out" aria-label="Zoom out" title="Zoom out (−)">−</button>
    <span class="cam zoom" aria-live="polite">100%</span>
    <button class="cam in" aria-label="Zoom in" title="Zoom in (+)">+</button>
    <button class="cam fit" title="Fit all (Shift+1)">Fit</button>
    <button class="cam reset" title="Reset camera (0)">Reset</button>
    <button class="cam layout" title="Put every item back where the page places it">Reset layout</button>
    <i class="cam sep"></i>
    <button class="cam move" aria-pressed="true" title="Move (V)">Move</button>
    <button class="cam hand" aria-pressed="false" title="Hand: drag anywhere to pan (H, or hold Space)">Hand</button>
    <button class="one prev" aria-label="Previous item" title="Previous (←)">‹</button>
    <span class="one current" aria-live="polite"></span>
    <button class="one next" aria-label="Next item" title="Next (→)">›</button>
    <span class="one note"></span>
    <i class="one sep"></i>
    <button class="one back" title="Every item side by side (Esc)">Canvas</button>
  </nav>
  <div class="tags"><i class="shield"></i><i class="edge l"></i><i class="edge r"></i><i class="edge t"></i><i class="edge b"></i><div class="map" role="img" aria-label="Minimap: click to move the camera there"><canvas></canvas></div></div>
  <p class="sr" id="move-help">Arrow keys move the item, Shift moves it further.</p>`;
  const $ = (s) => shadow.querySelector(s);
  const bar = $(".bar"), tags = $(".tags"), shield = $(".shield"), moveButton = $(".move"), handButton = $(".hand"), map = $(".map"), mapCanvas = $(".map canvas"), zoomText = $(".zoom"), currentText = $(".current"), noteText = $(".note");
  $(".count").textContent = variants.length + " items";

  // Canvas state. Positions and the camera are in plane pixels; screen = camera + plane × zoom.
  const GAP = 160, ROW = 5600, ROW_GAP = 240, MIN_Z = 0.05, MAX_Z = 4, LIMIT = 1e6, URL_HEIGHT = 900, LABEL_INSET = 24, KEEP = 160;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= LIMIT;
  const size = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? clamp(n, lo, hi) : null; };
  const coord = (v) => { const n = v && v.trim() ? Number(v) : 0; return finite(n) ? n : null; };
  const at = (el) => { const { x, y } = el.dataset; if (x == null && y == null) return null; const p = [coord(x), coord(y)]; return p.includes(null) ? null : p; };
  // Drop names the version it shows; a new version opens fitted, as a first visit, and keeps where the items were moved.
  const version = typeof self.__dropVersion === "string" ? self.__dropVersion : null;
  // `moved` separates reader moves from cached defaults so an authored layout can replace the defaults.
  const saved = { camera: null, positions: {}, authored: false }, moved = new Set();
  try {
    const doc = JSON.parse(localStorage.getItem(canvasKey) || "null");
    if (doc && doc.v === 1) {
      saved.authored = doc.authored === true;
      const c = (doc.version ?? null) === version ? doc.camera : null;
      if (c && finite(c.x) && finite(c.y) && finite(c.z) && c.z >= MIN_Z && c.z <= MAX_Z) saved.camera = { x: c.x, y: c.y, z: c.z };
      const ids = new Set(variants.map((el) => el.id));
      for (const [id, p] of Object.entries(doc.positions || {})) if (ids.has(id) && Array.isArray(p) && finite(p[0]) && finite(p[1])) saved.positions[id] = [p[0], p[1]];
      if (Array.isArray(doc.moved)) for (const id of doc.moved) if (ids.has(id)) moved.add(id);
    }
  } catch {}

  const items = variants.map((el, i) => {
    const width = size(el.dataset.width, 120, 8000), height = size(el.dataset.height, 80, 8000), src = Boolean(el.querySelector(":scope > iframe[data-prototype-src]"));
    const it = { el, i, name: nameOf(el), width, height, src, w: width || 1280, h: height || (src ? URL_HEIGHT : null), mw: 0, mh: 0, authored: el.getAttribute("style"), at: at(el) };
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.innerHTML = `<button class="handle" aria-describedby="move-help"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.4"/><circle cx="8" cy="2" r="1.4"/><circle cx="2" cy="7" r="1.4"/><circle cx="8" cy="7" r="1.4"/><circle cx="2" cy="12" r="1.4"/><circle cx="8" cy="12" r="1.4"/></svg></button><button class="name"></button><button class="open"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M7 1.5h3.5V5M5 10.5H1.5V7M10.5 1.5 7 5M1.5 10.5 5 7"/></svg></button><span class="done" role="status"></span><span class="tnote"></span>`;
    const handle = tag.querySelector(".handle"), name = tag.querySelector(".name"), open = tag.querySelector(".open"), done = tag.querySelector(".done");
    handle.setAttribute("aria-label", "Move " + it.name);
    open.setAttribute("aria-label", "Open " + it.name);
    open.title = "Open (" + (i < 9 ? i + 1 : "double-click the name") + ")";
    name.textContent = it.name;
    name.title = "Click to copy “" + it.name + "” · double-click to open";
    tag.querySelector(".tnote").textContent = el.dataset.note || "";
    tag.querySelector(".tnote").title = el.dataset.note || "";
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
      gesture = { kind: "move", id: e.pointerId, it, x: e.clientX, y: e.clientY, moved: false, before: snap() };
    });
    handle.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 64 : 8;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      record(snap());
      place(it, it.x + d[0], it.y + d[1]);
      settle();
    });
    tags.append(tag);
    return it;
  });
  // Keep legacy positions on unauthored canvases. Otherwise lay out the page before applying reader moves.
  const hasAuthored = items.some((it) => it.at !== null);
  const start = (it) => it.at || (!hasAuthored && !saved.authored && saved.positions[it.el.id]);
  function arrange() {
    let right = -Infinity;
    for (const it of items) {
      const p = start(it);
      if (p) { [it.x, it.y] = p; right = Math.max(right, it.x + it.w); }
    }
    // The rest follow in rows, each as tall as its tallest item; heights are known once measured.
    const left = right === -Infinity ? 0 : right + GAP;
    let x = left, y = 0, tall = 0;
    for (const it of items) {
      if (start(it)) continue;
      if (x > left && x + it.w > left + ROW) { x = left; y += tall + ROW_GAP; tall = 0; }
      it.x = x; it.y = y;
      x += it.w + GAP; tall = Math.max(tall, it.mh || it.h || 0);
    }
    for (const it of items) {
      const position = saved.positions[it.el.id];
      if (position && moved.has(it.el.id)) [it.x, it.y] = position;
    }
  }
  arrange();
  const place = (it, x, y) => { it.x = clamp(x, -LIMIT, LIMIT); it.y = clamp(y, -LIMIT, LIMIT); moved.add(it.el.id); schedule(); };
  // Undo and redo: each step keeps the layout from before a move or a Reset layout, and goes back saved as a drag is.
  // Until the reader's first step (`laid`), measuring the items lays the rows out again.
  const undos = [], redos = [];
  let laid = false;
  const snap = () => ({ at: items.map((it) => [it.x, it.y]), moved: [...moved], positions: saved.positions });
  const record = (before) => { laid = true; undos.push(before); if (undos.length > 100) undos.shift(); redos.length = 0; };
  function rewind(from, to) {
    const s = from.pop();
    if (!s) return false;
    to.push(snap());
    items.forEach((it, i) => { [it.x, it.y] = s.at[i]; });
    moved.clear();
    for (const id of s.moved) moved.add(id);
    saved.positions = s.positions;
    schedule(); settle();
    return true;
  }

  let mode = "", current = -1, gesture = null, space = false, tool = "move", frame = 0, settleTimer = 0, touched = false, suppressUntil = 0;
  let synced = false, reportedZoom = 0;
  let dockBottom = 72, fitted = null;
  const cam = saved.camera ? { ...saved.camera } : { x: 48, y: 64, z: 1 };
  const inset = () => parseFloat(getComputedStyle(root).getPropertyValue("--drop-inset")) || 0;
  const view = () => ({ w: Math.max(1, innerWidth - inset()), h: Math.max(1, innerHeight) });

  function setDockBottom(bottom) {
    if (bottom === dockBottom) return;
    dockBottom = bottom;
    if (mode === "canvas" && fitted) fit(fitted);
  }
  function dockMinimap() {
    if (mode !== "canvas" || !bar.isConnected) return;
    const toolbar = bar.getBoundingClientRect(), minimap = map.getBoundingClientRect();
    const overlaps = toolbar.right > minimap.left && toolbar.left < minimap.right;
    const raisedBottom = innerHeight - toolbar.top + 8;
    map.style.bottom = overlaps ? raisedBottom + "px" : "";
    setDockBottom(overlaps ? Math.max(72, raisedBottom + minimap.height + 8) : 72);
  }

  // One transform write per item per frame; previews never re-render for the camera. Labels stay at screen size.
  function render() {
    frame = 0;
    if (mode !== "canvas") return;
    for (const it of items) {
      const sx = cam.x + it.x * cam.z, sy = cam.y + it.y * cam.z;
      it.el.style.setProperty("transform", `translate(${sx}px, ${sy}px) scale(${cam.z})`, "important");
      // The handle sits in the gap left of the item, so the name and note start at the item's edge and end with it.
      const w = box(it).w * cam.z;
      it.tag.style.transform = `translate(${sx - LABEL_INSET}px, ${sy - 6}px) translateY(-100%)`;
      it.tag.style.width = w + LABEL_INSET + "px";
      it.tag.classList.toggle("narrow", w < 160);
    }
    drawMap();
    rest();
    const zoom = Math.round(cam.z * 100);
    zoomText.textContent = zoom + "%";
    if (zoom !== reportedZoom) report();
    // Drop's comment pins and areas sit on these items: they move with them in this frame, not after the gesture.
    document.dispatchEvent(new Event("canvasmove"));
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  // Live pages load when their item is within NEAR px of the screen, LOADING at a time, and sleep once it has been
  // further away for SLEEP ms. A page still loading after STALL ms is stopped and tried again only once its item has
  // left and come back near or the reader clicks Retry. The item in focus never sleeps (it's the only one near), nor
  // the one being typed in, nor any while Drop's comment tools are on or a thread is open.
  const NEAR = 600, LOADING = 2, SLEEP = 5000, STALL = 15000;
  let commenting = false, openThread = null, markers = [];
  let draftItem = null;
  document.addEventListener("drop:area-draft", (event) => {
    draftItem = event.detail instanceof Element ? event.detail.closest("[data-variant]") : null;
  });
  function near(it, v) {
    if (mode !== "canvas") return mode === "focus" && it.i === current;
    const b = box(it), x = cam.x + b.x * cam.z, y = cam.y + b.y * cam.z;
    return x < v.w + NEAR && y < v.h + NEAR && x + b.w * cam.z > -NEAR && y + b.h * cam.z > -NEAR;
  }
  function rest() {
    if (!lives.size) return;
    const v = view();
    let loading = [...lives.values()].filter((live) => live.state === "loading").length;
    for (const it of items) {
      const live = lives.get(it.el);
      if (!live) continue;
      if (near(it, v)) {
        clearTimeout(live.timer); live.timer = 0;
        if (live.state === "asleep" && loading < LOADING) { load(it, live); loading++; }
      } else if (live.state === "stalled") resetStall(it, live);
      else if (live.state !== "asleep" && !live.timer) {
        live.timer = setTimeout(() => { live.timer = 0; sleep(it, live); }, SLEEP);
      }
    }
  }
  function load(it, live) {
    const frame = live.frame;
    // The turn ends with the frame's load, which an error page fires too, with its sleep, or after STALL ms, when a new
    // empty frame takes its place and so stops the navigation. A frame being edited or reviewed checks again later.
    live.state = "loading";
    frame.addEventListener("load", () => { if (live.frame === frame && live.state === "loading") { clearTimeout(live.slow); live.state = "awake"; rest(); } }, { once: true });
    const stall = () => {
      if (live.frame !== frame || live.state !== "loading") return;
      if (document.activeElement === frame || draftItem === it.el || reviewedItem() === it.el) { live.slow = setTimeout(stall, SLEEP); return; }
      live.state = "stalled"; blank(it.el, live);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry preview";
      retry.setAttribute("aria-label", "Retry preview: " + nameOf(it.el));
      retry.setAttribute("data-prototype-retry", "");
      const retryPreview = () => { if (live.retry === retry) { resetStall(it, live); rest(); } };
      retry.addEventListener("click", retryPreview);
      retry.addEventListener("drop:retry-preview", retryPreview);
      live.retry = retry;
      it.el.setAttribute("data-prototype-stalled", "");
      it.el.append(retry);
      rest();
    };
    live.slow = setTimeout(stall, STALL);
    frame.src = live.url;
    it.el.removeAttribute("data-prototype-asleep");
  }
  function resetStall(it, live) {
    live.state = "asleep";
    live.retry.remove(); live.retry = null;
    it.el.removeAttribute("data-prototype-stalled");
  }
  function reviewedItem() {
    if (openThread === null) return null;
    const selector = markers.find((marker) => marker?.id === openThread)?.selector;
    if (typeof selector !== "string") return null;
    try { return document.querySelector(selector)?.closest("[data-variant]"); } catch { return null; }
  }
  const kept = (it) => commenting || openThread !== null || draftItem === it.el || it.el.contains(document.activeElement);
  // Focus moving between two frames tells this page nothing, so a kept frame checks again later.
  function sleep(it, live) {
    if (near(it, view())) return;
    if (kept(it)) { live.timer = setTimeout(() => { live.timer = 0; sleep(it, live); }, SLEEP); return; }
    clearTimeout(live.slow);
    live.state = "asleep";
    blank(it.el, live);
    rest();
  }
  // The fence. Each item gives the camera a box of places where the screen still shows KEEP px of it, or all of it
  // when it's smaller; the camera may stand in any of them, so the plane never pans into emptiness. A pan (`from` is
  // where it started) slides along the box it's in rather than jumping across an empty gap to another item's; a jump
  // (zoom, fit, the minimap) lands in the nearest box. Returns the sides it stopped at.
  function bound(from) {
    cam.z = clamp(cam.z, MIN_Z, MAX_Z);
    cam.x = clamp(cam.x, -LIMIT, LIMIT); cam.y = clamp(cam.y, -LIMIT, LIMIT);
    const v = view(), z = cam.z;
    const boxes = items.map((it) => {
      const b = box(it), kx = Math.min(KEEP, b.w * z), ky = Math.min(KEEP, b.h * z);
      return { x0: kx - (b.x + b.w) * z, x1: v.w - kx - b.x * z, y0: ky - (b.y + b.h) * z, y1: v.h - ky - b.y * z };
    });
    const inside = (r, c) => c.x >= r.x0 - .5 && c.x <= r.x1 + .5 && c.y >= r.y0 - .5 && c.y <= r.y1 + .5;
    if (!boxes.length || boxes.some((r) => inside(r, cam))) return null;
    const near = from ? boxes.filter((r) => inside(r, from)) : [];
    const gap = (r) => (clamp(cam.x, r.x0, r.x1) - cam.x) ** 2 + (clamp(cam.y, r.y0, r.y1) - cam.y) ** 2;
    const r = (near.length ? near : boxes).reduce((a, b) => gap(b) < gap(a) ? b : a);
    const hit = { l: cam.x > r.x1, r: cam.x < r.x0, t: cam.y > r.y1, b: cam.y < r.y0 };
    cam.x = clamp(cam.x, r.x0, r.x1); cam.y = clamp(cam.y, r.y0, r.y1);
    return hit;
  }
  // A pan by dx, dy that stops at the fence, with a short blue flash on the side it stopped at.
  function pan(dx, dy) {
    const from = { x: cam.x, y: cam.y };
    cam.x += dx; cam.y += dy; touched = true; fitted = null;
    const hit = bound(from);
    if (hit) for (const side of "lrtb") if (hit[side]) flash(side);
    schedule();
  }
  function flash(side) {
    const el = $(".edge." + side);
    el.classList.remove("fade"); el.style.opacity = "1";
    requestAnimationFrame(() => { el.classList.add("fade"); el.style.opacity = "0"; });
  }
  // A zoom floor: half of what fits everything, so the content never shrinks to a dot.
  const floor = () => { const v = view(), b = extent(items); return b ? clamp(Math.min((v.w - 64) / b.w, (v.h - 128) / b.h, 1) / 2, MIN_Z, 1) : MIN_Z; };
  function extent(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of list) { const b = box(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return Number.isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null;
  }

  // The minimap: every item and the screen, framed around both. While its box is dragged the frame holds still.
  let mapFrame = null;
  function frameMap() {
    if (mapFrame) return mapFrame;
    const b = extent(items), v = view();
    if (!b) return null;
    let x0 = Math.min(b.x0, -cam.x / cam.z), y0 = Math.min(b.y0, -cam.y / cam.z), x1 = Math.max(b.x1, (v.w - cam.x) / cam.z), y1 = Math.max(b.y1, (v.h - cam.y) / cam.z);
    const px = (x1 - x0) * 0.06, py = (y1 - y0) * 0.06;
    x0 -= px; x1 += px; y0 -= py; y1 += py;
    const W = map.clientWidth, H = map.clientHeight, s = Math.min(W / (x1 - x0), H / (y1 - y0));
    return { s, ox: (W - (x1 - x0) * s) / 2 - x0 * s, oy: (H - (y1 - y0) * s) / 2 - y0 * s };
  }
  function drawMap() {
    const W = map.clientWidth, H = map.clientHeight, f = frameMap(), dpr = devicePixelRatio || 1;
    if (!W || !f) return;
    if (mapCanvas.width !== Math.round(W * dpr)) { mapCanvas.width = Math.round(W * dpr); mapCanvas.height = Math.round(H * dpr); }
    const ctx = mapCanvas.getContext("2d"), v = view();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#e5e5e5"; ctx.strokeStyle = "#a3a3a3"; ctx.lineWidth = 1;
    for (const it of items) {
      const b = box(it), x = f.ox + b.x * f.s, y = f.oy + b.y * f.s;
      ctx.fillRect(x, y, b.w * f.s, b.h * f.s);
      ctx.strokeRect(x + .5, y + .5, Math.max(0, b.w * f.s - 1), Math.max(0, b.h * f.s - 1));
    }
    const sx = f.ox - cam.x / cam.z * f.s, sy = f.oy - cam.y / cam.z * f.s, sw = v.w / cam.z * f.s, sh = v.h / cam.z * f.s;
    ctx.fillStyle = "rgb(37 99 235 / .1)"; ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeRect(sx, sy, sw, sh);
  }
  const onMap = (e) => {
    const r = map.getBoundingClientRect(), f = mapFrame || frameMap();
    return { x: (e.clientX - r.left - f.ox) / f.s, y: (e.clientY - r.top - f.oy) / f.s };
  };
  function centreOn(x, y) {
    const v = view();
    cam.x = v.w / 2 - x * cam.z; cam.y = v.h / 2 - y * cam.z; touched = true; fitted = null;
    bound(); schedule();
  }
  let mapDrag = null;
  map.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || gesture) return;
    e.preventDefault(); e.stopPropagation();
    mapFrame = frameMap();
    const p = onMap(e), v = view(), x0 = -cam.x / cam.z, y0 = -cam.y / cam.z, x1 = x0 + v.w / cam.z, y1 = y0 + v.h / cam.z;
    const held = p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    try { map.setPointerCapture(e.pointerId); } catch {}
    mapDrag = { id: e.pointerId, dx: held ? p.x - (x0 + x1) / 2 : 0, dy: held ? p.y - (y0 + y1) / 2 : 0 };
    if (!held) centreOn(p.x, p.y);
  });
  map.addEventListener("pointermove", (e) => {
    if (!mapDrag || e.pointerId !== mapDrag.id) return;
    const p = onMap(e);
    centreOn(p.x - mapDrag.dx, p.y - mapDrag.dy);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) map.addEventListener(type, (e) => {
    if (!mapDrag || e.pointerId !== mapDrag.id) return;
    mapDrag = null; mapFrame = null; schedule(); settle();
  });
  // After a gesture: save, and let Drop's comment pins measure their anchors again.
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settleTimer = 0; save(); window.dispatchEvent(new Event("resize")); }, 160);
  }
  function save() {
    const positions = {};
    for (const it of items) positions[it.el.id] = [Math.round(it.x), Math.round(it.y)];
    const doc = { v: 1, camera: mode === "canvas" || saved.camera ? { x: Math.round(cam.x * 100) / 100, y: Math.round(cam.y * 100) / 100, z: Math.round(cam.z * 1e4) / 1e4 } : null, positions, moved: [...moved], authored: hasAuthored, version };
    try { localStorage.setItem(canvasKey, JSON.stringify(doc)); } catch {}
  }
  function zoomAt(z, px, py) {
    z = clamp(z, Math.min(floor(), cam.z), MAX_Z);
    const wx = (px - cam.x) / cam.z, wy = (py - cam.y) / cam.z;
    cam.z = z; cam.x = px - wx * z; cam.y = py - wy * z;
    touched = true; fitted = null; bound(); schedule(); settle();
  }
  const zoomCenter = (f) => { const v = view(); zoomAt(cam.z * f, v.w / 2, v.h / 2); };
  const box = (it) => ({ x: it.x, y: it.y, w: it.mw || it.w, h: it.mh || it.h || 1 });
  // Fits the given items between the top labels and the bottom bar, at 100% or less.
  function fit(list = items) {
    const v = view(), top = 56, bottom = dockBottom, side = 64, b = extent(list);
    if (!b) return;
    fitted = list;
    const { x0, y0, x1, y1 } = b;
    const z = clamp(Math.min((v.w - side * 2) / (x1 - x0), (v.h - top - bottom) / (y1 - y0), 1), MIN_Z, MAX_Z);
    cam.z = z;
    cam.x = (v.w - (x1 - x0) * z) / 2 - x0 * z;
    cam.y = top + Math.max(0, (v.h - top - bottom - (y1 - y0) * z) / 2) - y0 * z;
    bound(); schedule(); settle();
  }
  function reset() { cam.x = 48; cam.y = 64; cam.z = 1; touched = true; fitted = null; bound(); schedule(); settle(); }
  // Reset layout: forget this reader's moves, so every item stands where the page places it, and fit them all.
  function relayout() { if (moved.size || Object.keys(saved.positions).length) record(snap()); saved.positions = {}; moved.clear(); arrange(); fit(); }
  // Centres an item at the current zoom, or fits it when it's bigger than the screen.
  function reveal(it) {
    const v = view(), b = box(it);
    if (b.w * cam.z > v.w - 64 || b.h * cam.z > v.h - 56 - dockBottom) return fit([it]);
    fitted = null;
    cam.x = (v.w - b.w * cam.z) / 2 - b.x * cam.z;
    cam.y = Math.max(56, (v.h - dockBottom - b.h * cam.z) / 2) - b.y * cam.z;
    bound(); schedule(); settle();
  }
  const sizes = new ResizeObserver(() => {
    for (const it of items) { if (it.el.offsetWidth) it.mw = it.el.offsetWidth; if (it.el.offsetHeight) it.mh = it.el.offsetHeight; }
    if (!laid) { arrange(); schedule(); }
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
    hand();
    schedule();
    // Coming back from focus centres that item; the first visit fits everything, unless a camera is saved.
    const go = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (mode !== "canvas") return;
      if (!laid) { laid = true; arrange(); save(); }
      if (from) reveal(from);
      else if (!saved.camera && !touched) fit();
      else { bound(); schedule(); }
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
    fitted = null;
    if (mode === "canvas") {
      saved.camera = { ...cam };
      for (const it of items) sizes.unobserve(it.el);
      delete root.dataset.prototypeLayout;
      tags.classList.remove("on");
      bar.classList.remove("canvas");
    }
    mode = "focus";
    hand();
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
    currentText.title = it.name; noteText.title = it.el.dataset.note || "";
    noteText.title = it.el.dataset.note || "";
    noteText.hidden = !it.el.dataset.note;
    try { localStorage.setItem(key, it.el.id); } catch {}
    hash(it.el.id);
    rest();
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
    parent.postMessage({ __drop: true, type: "variants", variants: list, current: Math.max(current, 0), canvas: mode === "canvas", zoom: reportedZoom, tool }, "*");
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
    layout: () => mode === "canvas" && relayout(),
    move: () => pick("move"),
    hand: () => pick("hand"),
    // Space held while Drop's window has focus.
    hold: () => hold(true),
    release: () => hold(false),
  };
  if (hosted) window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.__drop !== true) return;
    if (m.type === "inset" && Number.isFinite(m.bottom)) {
      setDockBottom(Math.max(72, m.bottom + 4));
    } else if (m.type === "tool" && typeof m.tool === "string") { commenting = m.tool !== "browse"; rest(); }
    else if (m.type === "active") { openThread = typeof m.id === "string" ? m.id : null; rest(); }
    else if (m.type === "markers" && Array.isArray(m.markers)) markers = m.markers;
    else if (m.type === "picker" && Object.hasOwn(commands, m.do)) commands[m.do](m);
  });

  $(".prev").onclick = () => toFocus(current - 1);
  $(".next").onclick = () => toFocus(current + 1);
  $(".back").onclick = toCanvas;
  $(".out").onclick = () => zoomCenter(1 / 1.25);
  $(".in").onclick = () => zoomCenter(1.25);
  $(".fit").onclick = () => fit();
  $(".reset").onclick = reset;
  $(".layout").onclick = relayout;
  moveButton.onclick = () => pick("move");
  handButton.onclick = () => pick("hand");
  window.addEventListener("hashchange", () => { const i = find(location.hash.slice(1)); if (i >= 0) toFocus(i); });

  const typing = (t) => t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
  const interactive = (t) => t === host || typing(t) || (t && t.closest && t.closest("a[href], button, summary, [tabindex], [contenteditable]"));
  const digit = (e) => /^[1-9]$/.test(e.key) && Number(e.key) <= variants.length;
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    // ⌘Z or Ctrl+Z takes back the last move, ⇧⌘Z or Ctrl+Y redoes it. A field keeps its own undo, and Drop's Marker its own.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && mode === "canvas" && !e.defaultPrevented && !commenting && !typing(e.composedPath()[0])) {
      const k = e.key.toLowerCase(), again = k === "y" ? e.ctrlKey && !e.metaKey : k === "z" && e.shiftKey;
      if ((k === "z" || again) && (again ? rewind(redos, undos) : rewind(undos, redos))) e.preventDefault();
      return;
    }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(t) || !several) return;
    // With text selected, C is Drop's: it comments on the selection.
    if ((e.key === "c" || e.key === "C") && !String(getSelection() || "")) { if (mode === "canvas") toFocus(Math.max(current, 0)); else toCanvas(); e.preventDefault(); return; }
    if (mode === "canvas") {
      // Shadow controls (handles, names, the bar) keep their own keys; the plane takes the rest.
      if (t === host) return;
      if (e.key === " ") { if (interactive(t)) return; hold(true); e.preventDefault(); return; }
      if (e.key === "h" || e.key === "H") { pick("hand"); e.preventDefault(); return; }
      if (e.key === "v" || e.key === "V") { pick("move"); return; }
      if (interactive(t) && t !== document.body) return;
      const step = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[e.key];
      if (step) { pan(step[0], step[1]); settle(); }
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
  window.addEventListener("keyup", (e) => { if (e.key === " ") hold(false); });

  // The Hand tool, or Space held: a shield over the items takes the pointer, so a drag pans from anywhere, live pages
  // included, and the items get no clicks or hovers until it's put down. The cursor says which: grab, then grabbing.
  function hold(on) { if (space !== on) { space = on; hand(); } }
  function pick(next) {
    if (tool === next) return;
    tool = next;
    hand();
    report();
  }
  // A pan keeps the Hand up until the drag ends, even once Space is let go: Drop's comment tools stand aside only while
  // the root carries data-prototype-hand, and the rest of the drag has to reach the picker.
  function hand() {
    const grabbing = mode === "canvas" && Boolean(gesture && gesture.kind === "pan"), on = grabbing || (mode === "canvas" && (tool === "hand" || space));
    tags.classList.toggle("hand", on);
    tags.classList.toggle("grabbing", Boolean(grabbing));
    if (on) root.dataset.prototypeHand = grabbing ? "grabbing" : "";
    else delete root.dataset.prototypeHand;
    moveButton.setAttribute("aria-pressed", String(tool === "move"));
    handButton.setAttribute("aria-pressed", String(tool === "hand"));
  }

  // Gestures. The Hand tool, Space + drag, and middle-drag pan anywhere and win over everything else; a plain drag pans
  // only from empty space, so previews keep their clicks, selection, and inputs.
  function endGesture() {
    if (!gesture) return;
    if (gesture.moved) suppressUntil = performance.now() + 400;
    if (gesture.kind === "move" && gesture.moved) record(gesture.before);
    gesture = null;
    hand();
    settle();
  }
  window.addEventListener("pointerdown", (e) => {
    if (mode !== "canvas" || gesture) return;
    const empty = e.target === root || e.target === document.body, shielded = e.composedPath()[0] === shield;
    if (!(e.button === 1 || (e.button === 0 && (space || shielded || (empty && e.pointerType === "mouse"))))) return;
    e.preventDefault();
    e.stopPropagation();
    try { root.setPointerCapture(e.pointerId); } catch {}
    gesture = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    hand();
  }, true);
  window.addEventListener("pointermove", (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    gesture.x = e.clientX; gesture.y = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 0) gesture.moved = true;
    if (gesture.kind === "pan") pan(dx, dy);
    else if (dx || dy) place(gesture.it, gesture.it.x + dx / cam.z, gesture.it.y + dy / cam.z);
  }, true);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) window.addEventListener(type, (e) => { if (gesture && e.pointerId === gesture.id) endGesture(); }, true);
  // After a pan or a move, the release doesn't click, copy, follow a link, or start middle-click autoscroll.
  for (const type of ["click", "auxclick"]) window.addEventListener(type, (e) => {
    if (performance.now() < suppressUntil) { suppressUntil = 0; e.preventDefault(); e.stopPropagation(); }
  }, true);
  const drop = () => { hold(false); endGesture(); };
  window.addEventListener("blur", drop);
  document.addEventListener("visibilitychange", () => { if (document.hidden) drop(); });

  // A nested scroller that can still scroll in the wheel's direction keeps the wheel; otherwise the plane pans.
  function room(el, dx, dy) {
    const s = getComputedStyle(el);
    return Boolean((dy && /auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1 && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0))
      || (dx && /auto|scroll/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1 && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0)));
  }
  function scrolls(t, dx, dy) {
    for (let el = t; el && el !== document.body && el !== root; el = el.parentElement) if (room(el, dx, dy)) return el;
    return null;
  }
  // One wheel gesture stays with what it started on, as a browser latches scrolling: a scroll inside an item stops at
  // the end of its list instead of carrying on into the plane, and a pan keeps panning when an item slides under the
  // pointer. A pause of LATCH ms starts a new gesture.
  const LATCH = 250;
  let latched = null, latchedAt = -Infinity;
  window.addEventListener("wheel", (e) => {
    if (mode !== "canvas" || e.composedPath().includes(bar)) return;
    if (e.composedPath().includes(map)) { e.preventDefault(); return; }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); latched = null; zoomAt(cam.z * Math.exp(-clamp(dy, -30, 30) / 100), e.clientX, e.clientY); return; }
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    if (e.timeStamp - latchedAt > LATCH || !latched) latched = scrolls(e.target, dx, dy) || "plane";
    latchedAt = e.timeStamp;
    if (latched !== "plane") {
      // At the end of its list the wheel does nothing, as it does at the end of a page.
      if (!latched.isConnected || !room(latched, dx, dy)) e.preventDefault();
      return;
    }
    e.preventDefault();
    pan(-dx, -dy); settle();
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
    if (dx || dy) { pan(dx, dy); settle(); }
  });
  window.addEventListener("resize", () => { if (mode === "canvas") { dockMinimap(); bound(); } schedule(); });
  window.addEventListener("pagehide", () => { if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; save(); } });

  // Arrows between screens. In an item, a control with data-go="<id>" draws an arrow from its right edge to the element
  // with that id in the same item, with its data-label beside it. The arrow leaves the [data-screen] that holds the
  // control and takes the way the target lies: a curve to a screen on the right, down the gap to one in a lower row,
  // over the top back to one on the left. Hovering a screen or a control lights its arrows and dims the rest.
  const flowCss = document.createElement("style");
  flowCss.textContent = `body > [data-variant]:has([data-go]) { position: relative; }
    [data-drop-flow] { position: absolute; left: 0; top: 0; z-index: 2; pointer-events: none; }
    [data-drop-flow] svg { position: absolute; left: 0; top: 0; overflow: visible; }
    [data-drop-flow] g path, [data-drop-flow] g circle { fill: none; stroke: #a1a1aa; stroke-width: 1.75; transition: stroke .15s, opacity .15s; }
    [data-drop-flow] g circle { fill: #fff; }
    [data-drop-flow] g.on path, [data-drop-flow] g.on circle { stroke: #2563eb; }
    [data-drop-flow] .off { opacity: .12; }
    [data-drop-flow] span { position: absolute; transform: translate(-50%, -50%); padding: 4px 10px; border: 1px solid #e4e4e7; border-radius: 99px; background: #fff;
      color: #52525b; font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; transition: opacity .15s, color .15s, border-color .15s; }
    [data-drop-flow] span.on { color: #2563eb; border-color: #93b4f5; }
    [data-go] { outline: 5px solid rgb(37 99 235 / .4); outline-offset: 3px; }
    [data-go][data-go-on] { outline-color: #2563eb; }
    @media (prefers-reduced-motion: reduce) { [data-drop-flow] * { transition: none !important; } }`;
  document.head.append(flowCss);
  const layers = new Map();
  const curveAt = (p0, p1, p2, p3, t) => [0, 1].map((n) => (1 - t) ** 3 * p0[n] + 3 * (1 - t) ** 2 * t * p1[n] + 3 * (1 - t) * t * t * p2[n] + t ** 3 * p3[n]);
  function route(f, fs, t) {
    const x1 = Math.min(Math.max(f.x + f.w + 6, fs.x + 16), fs.x + fs.w + 6), y1 = f.y + f.h / 2;
    if (t.y >= fs.y + fs.h) {
      const xg = fs.x + fs.w + 26, yg = t.y - 34, x2 = t.x + t.w / 2, r = 14, d = x2 < xg ? 1 : -1;
      return { d: `M${x1} ${y1}L${xg - r} ${y1}Q${xg} ${y1} ${xg} ${y1 + r}L${xg} ${yg - r}Q${xg} ${yg} ${xg - d * r} ${yg}L${x2 + d * r} ${yg}Q${x2} ${yg} ${x2} ${yg + r}L${x2} ${t.y - 8}`, l: [xg, (y1 + yg) / 2] };
    }
    if (t.x >= fs.x + fs.w) {
      const x2 = t.x - 8, y2 = clamp(y1, t.y + 30, Math.max(t.y + 30, t.y + t.h - 30)), dx = Math.max(40, (x2 - x1) * 0.45);
      const c1 = [x1 + dx, y1], c2 = [x2 - dx, y2], mid = curveAt([x1, y1], c1, c2, [x2, y2], 0.5);
      return { d: `M${x1} ${y1}C${c1} ${c2} ${x2} ${y2}`, l: [Math.max(mid[0], fs.x + fs.w + 72), mid[1]] };
    }
    const xs = fs.x + fs.w + 10, top = Math.min(fs.y, t.y) - 30, x2 = t.x + t.w * 0.72, r = 12;
    return { d: `M${x1} ${y1}C${xs + 50} ${y1} ${xs + 50} ${top} ${xs} ${top}L${x2 + r} ${top}Q${x2} ${top} ${x2} ${top + r}L${x2} ${t.y - 8}`, l: [(xs + x2) / 2, top] };
  }
  function drawFlow(el) {
    let layer = layers.get(el);
    const controls = [...el.querySelectorAll("[data-go]")];
    if (!controls.length && !layer) return;
    if (!layer) {
      layer = document.createElement("div");
      layer.setAttribute("data-drop-flow", "");
      layer.setAttribute("aria-hidden", "true");
      layers.set(el, layer);
    }
    if (layer.parentNode !== el) el.append(layer);
    layer.links = [];
    if (!el.offsetWidth) return;
    const s = el.getBoundingClientRect(), k = s.width / el.offsetWidth || 1;
    const at = (n) => { const r = n.getBoundingClientRect(); return { x: (r.left - s.left) / k - el.clientLeft + el.scrollLeft, y: (r.top - s.top) / k - el.clientTop + el.scrollTop, w: r.width / k, h: r.height / k }; };
    const head = "drop-flow-head-" + variants.indexOf(el);
    let paths = "", labels = "";
    for (const a of controls) {
      const to = document.getElementById(a.dataset.go), from = a.closest("[data-screen]") || a;
      if (!to || !el.contains(to) || !a.getClientRects().length || !to.getClientRects().length) continue;
      const f = at(a), fs = at(from), rt = route(f, fs, at(to)), n = layer.links.length;
      layer.links.push({ a, from, to });
      paths += `<g data-n="${n}"><path d="${rt.d}" marker-end="url(#${head})"/><circle cx="${Math.min(Math.max(f.x + f.w + 2, fs.x + 12), fs.x + fs.w + 2)}" cy="${f.y + f.h / 2}" r="4"/></g>`;
      if (a.dataset.label) labels += `<span data-n="${n}" style="left:${rt.l[0]}px;top:${rt.l[1]}px"></span>`;
    }
    layer.innerHTML = `<svg width="${el.scrollWidth}" height="${el.scrollHeight}"><defs><marker id="${head}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" style="fill:none;stroke:context-stroke;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"/></marker></defs>${paths}</svg>${labels}`;
    for (const span of layer.querySelectorAll("span")) span.textContent = layer.links[span.dataset.n].a.dataset.label;
  }
  function lightFlow(el, target) {
    const layer = layers.get(el);
    if (!layer || !layer.links) return;
    const control = target && target.closest && target.closest("[data-go]"), screen = target && target.closest && target.closest("[data-screen]");
    const lit = layer.links.map((l) => (control ? l.a === control : screen ? l.from === screen || l.to === screen : false));
    const any = lit.some(Boolean);
    for (const node of layer.querySelectorAll("[data-n]")) { const on = lit[node.dataset.n]; node.classList.toggle("on", on); node.classList.toggle("off", any && !on); }
    layer.links.forEach((l, n) => l.a.toggleAttribute("data-go-on", lit[n]));
  }
  const dirty = new Set();
  let flowFrame = 0;
  const redrawFlow = (el) => {
    if (!el) return;
    dirty.add(el);
    flowFrame ||= requestAnimationFrame(() => { flowFrame = 0; for (const d of dirty) drawFlow(d); dirty.clear(); });
  };
  const itemOf = (n) => variants.find((el) => el.contains(n));
  const flowSizes = new ResizeObserver((entries) => { for (const e of entries) redrawFlow(itemOf(e.target)); });
  const flowChanges = new MutationObserver((records) => {
    for (const r of records) {
      const el = itemOf(r.target);
      if (el && !(layers.get(el) && layers.get(el).contains(r.target))) redrawFlow(el);
    }
  });
  for (const el of variants) {
    if (el.dataset.src) continue;
    flowSizes.observe(el);
    flowChanges.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-go", "data-label", "data-screen", "hidden"] });
    el.addEventListener("pointerover", (e) => lightFlow(el, e.target));
    el.addEventListener("pointerleave", () => lightFlow(el, null));
    redrawFlow(el);
  }
  if (document.fonts) document.fonts.ready.then(() => variants.forEach(redrawFlow));

  if (hosted || !several) bar.remove();
  document.body.append(host);
  if (bar.isConnected) new ResizeObserver(dockMinimap).observe(bar);
  // A hash names an item to open in focus; otherwise two or more items open on the canvas.
  const named = find(location.hash.slice(1));
  current = Math.max(find(remembered()), 0);
  if (named >= 0) toFocus(named);
  else if (!several || /^(single|picker)$/.test(document.body.dataset.layout || "")) toFocus(current);
  else toCanvas();
})();
