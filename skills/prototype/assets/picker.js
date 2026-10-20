// Drop prototype picker. Paste into a <script> at the end of the prototype's <body>, unchanged.
// Every top-level <section id="v-…" data-variant="Label" data-note="One line"> is one variant. The picker has two
// layouts, switched with its Canvas button or the C key:
// - One at a time: switch with the bar, the ← and → keys, or 1–9.
// - Canvas: every variant side by side on a plane at its real size, `data-width` (px, default 1280) by `data-height`
//   (px, default its content). Drag empty space, Space + drag, or middle-drag to pan; Ctrl/⌘ + wheel or pinch to zoom;
//   1–9 reveal a variant, + and − zoom, Shift+1 fits all, 0 resets the camera. Click a name to copy it; drag the
//   handle beside it, or focus it and press the arrow keys, to move the variant.
// `<body data-layout="canvas">` opens the canvas first. The page remembers the reader's layout, the variant they last
// picked, and the canvas camera and positions (never content). It opens the variant in the URL hash (#v-…), and fires
// `variantchange` on document ({ detail: { id, label, visible } }) whenever the visible set or the current variant
// changes: `visible` lists the ids on screen (one in the picker, all in the canvas), so a variant animates while
// `visible.includes(its id)`.
(() => {
  const variants = [...document.querySelectorAll("body > [data-variant]")];
  if (!variants.length) return;
  const root = document.documentElement;
  const key = "drop-prototype:" + location.pathname;
  const canvasKey = "drop-prototype-canvas:" + location.pathname;
  const remembered = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const find = (id) => variants.findIndex((el) => el.id === id);
  const nameOf = (el) => el.dataset.variant || el.id;
  // A variant's own `display` (an id rule with grid, say) beats the hidden attribute's default style. In the canvas
  // the page stops scrolling and the plane takes its gestures; previews keep their own cursors.
  const css = document.createElement("style");
  css.textContent = `body > [data-variant][hidden] { display: none !important; }
    html[data-prototype-layout="canvas"], html[data-prototype-layout="canvas"] body { overflow: hidden !important; overscroll-behavior: none !important; height: 100% !important; }
    html[data-prototype-layout="canvas"] body { margin: 0 !important; cursor: default; }
    html[data-prototype-layout="canvas"] body > [data-variant] { cursor: auto; }`;
  document.head.append(css);

  const host = document.createElement("prototype-picker");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    .bar { position: fixed; z-index: 2147483000; bottom: 16px; left: calc((100vw - var(--drop-inset, 0px)) / 2); transform: translateX(-50%);
      display: flex; align-items: center; gap: 4px; max-width: calc(100vw - var(--drop-inset, 0px) - 32px); padding: 4px;
      border: 1px solid rgb(255 255 255 / .12); border-radius: 12px; background: rgb(17 17 17 / .92); color: #fafafa;
      font: 500 12px/1 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / .25); backdrop-filter: blur(8px); }
    button { all: unset; box-sizing: border-box; height: 28px; padding: 0 10px; border-radius: 8px; color: #a3a3a3; cursor: pointer; white-space: nowrap; }
    button:hover { color: #fafafa; background: rgb(255 255 255 / .08); }
    button[aria-pressed="true"] { color: #0a0a0a; background: #fafafa; }
    button:focus-visible { outline: 2px solid #fafafa; outline-offset: 1px; }
    .list { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
    .note { padding: 0 8px; color: #a3a3a3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 32ch; }
    .n { font-variant-numeric: tabular-nums; opacity: .6; margin-right: 6px; }
    .cam { display: none; align-items: center; gap: 2px; padding-left: 4px; border-left: 1px solid rgb(255 255 255 / .12); }
    .cam button { padding: 0 8px; }
    .zoom { min-width: 5ch; text-align: center; color: #a3a3a3; font-variant-numeric: tabular-nums; }
    .bar.canvas .cam { display: flex; }
    .bar.canvas .note, .bar.min .list, .bar.min .note, .bar.min .cam { display: none; }
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
    .tag > .name { flex-shrink: 0; max-width: calc(100% - 20px); }
    .handle { width: 20px; padding: 0; display: grid; place-items: center; color: #a3a3a3 !important; touch-action: none; }
    .handle:hover { color: #525252 !important; }
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
  <nav class="bar" aria-label="Prototype variants">
    <button class="prev" aria-label="Previous variant">←</button>
    <div class="list" role="group"></div>
    <button class="next" aria-label="Next variant">→</button>
    <span class="note"></span>
    <div class="cam" role="group" aria-label="Camera">
      <button class="out" aria-label="Zoom out" title="Zoom out (−)">−</button>
      <span class="zoom" aria-live="polite">100%</span>
      <button class="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
      <button class="fit" title="Fit all (Shift+1)">Fit</button>
      <button class="reset" title="Reset camera (0)">Reset</button>
    </div>
    <button class="layout" aria-pressed="false" title="Show every variant side by side (C)">Canvas</button>
    <button class="fold" aria-label="Fold the picker">–</button>
  </nav>
  <div class="tags"></div>
  <p class="sr" id="move-help">Arrow keys move the variant, Shift moves it further.</p>`;
  const $ = (s) => shadow.querySelector(s);
  const bar = $(".bar"), list = $(".list"), note = $(".note"), fold = $(".fold"), tags = $(".tags"), zoomText = $(".zoom"), layoutButton = $(".layout");
  const buttons = variants.map((el, i) => {
    const button = document.createElement("button");
    button.innerHTML = `<span class="n" aria-hidden="true">${i + 1}</span>`;
    button.append(nameOf(el));
    button.onclick = () => show(i);
    list.append(button);
    return button;
  });

  // Canvas state. Positions and the camera are in plane pixels; screen = camera + plane × zoom.
  const GAP = 160, MIN_Z = 0.05, MAX_Z = 4, LIMIT = 1e6;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= LIMIT;
  const size = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? clamp(n, lo, hi) : null; };
  const saved = { camera: null, positions: {}, layout: null };
  try {
    const doc = JSON.parse(localStorage.getItem(canvasKey) || "null");
    if (doc && doc.v === 1) {
      const c = doc.camera;
      if (c && finite(c.x) && finite(c.y) && finite(c.z) && c.z >= MIN_Z && c.z <= MAX_Z) saved.camera = { x: c.x, y: c.y, z: c.z };
      const ids = new Set(variants.map((el) => el.id));
      for (const [id, p] of Object.entries(doc.positions || {})) if (ids.has(id) && Array.isArray(p) && finite(p[0]) && finite(p[1])) saved.positions[id] = [p[0], p[1]];
      if (doc.layout === "canvas" || doc.layout === "picker") saved.layout = doc.layout;
    }
  } catch {}

  const items = variants.map((el, i) => {
    const it = { el, i, name: nameOf(el), w: size(el.dataset.width, 120, 8000) || 1280, h: size(el.dataset.height, 80, 8000), mw: 0, mh: 0, style: null };
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.innerHTML = `<button class="handle" aria-describedby="move-help"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.4"/><circle cx="8" cy="2" r="1.4"/><circle cx="2" cy="7" r="1.4"/><circle cx="8" cy="7" r="1.4"/><circle cx="2" cy="12" r="1.4"/><circle cx="8" cy="12" r="1.4"/></svg></button><button class="name"></button><span class="done" role="status"></span><span class="hint">Click to copy the name</span><span class="tnote"></span>`;
    const handle = tag.querySelector(".handle"), name = tag.querySelector(".name"), done = tag.querySelector(".done");
    handle.setAttribute("aria-label", "Move " + it.name);
    name.textContent = it.name;
    name.title = "Copy “" + it.name + "”";
    tag.querySelector(".tnote").textContent = el.dataset.note || "";
    it.tag = tag;
    let timer = 0;
    name.onclick = async () => {
      clearTimeout(timer);
      try {
        await navigator.clipboard.writeText(it.name);
        done.textContent = "Copied";
      } catch {
        try { getSelection().selectAllChildren(name); } catch {}
        done.textContent = "Select the name and copy it";
      }
      timer = setTimeout(() => { done.textContent = ""; }, 1600);
    };
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
  // Saved positions first; new variants go in the empty space to the right of the rest.
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

  let layout = "picker", current = -1, gesture = null, space = false, frame = 0, settleTimer = 0, touched = false, suppressUntil = 0;
  const cam = saved.camera ? { ...saved.camera } : { x: 48, y: 64, z: 1 };
  const inset = () => parseFloat(getComputedStyle(root).getPropertyValue("--drop-inset")) || 0;
  const view = () => ({ w: Math.max(1, innerWidth - inset()), h: Math.max(1, innerHeight) });

  // One transform write per item per frame; previews never re-render for the camera.
  function render() {
    frame = 0;
    if (layout !== "canvas") return;
    for (const it of items) {
      const sx = cam.x + it.x * cam.z, sy = cam.y + it.y * cam.z;
      it.el.style.setProperty("transform", `translate(${sx}px, ${sy}px) scale(${cam.z})`, "important");
      it.tag.style.transform = `translate(${sx}px, ${sy - 30}px)`;
      it.tag.style.maxWidth = Math.max(it.w * cam.z, 56) + "px";
    }
    zoomText.textContent = Math.round(cam.z * 100) + "%";
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
    const doc = { v: 1, layout, camera: layout === "canvas" || saved.camera ? { x: Math.round(cam.x * 100) / 100, y: Math.round(cam.y * 100) / 100, z: Math.round(cam.z * 1e4) / 1e4 } : null, positions };
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
  // Brings a variant into view at the current zoom, or fits it when it's bigger than the screen.
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

  function enterCanvas() {
    layout = "canvas";
    root.dataset.prototypeLayout = "canvas";
    for (const it of items) {
      const el = it.el, s = el.style;
      it.style = el.getAttribute("style");
      el.hidden = false;
      for (const [p, val] of [["position", "absolute"], ["left", "0"], ["top", "0"], ["margin", "0"], ["width", it.w + "px"], ["max-width", "none"],
        ["min-width", "0"], ["box-sizing", "border-box"], ["transform-origin", "0 0"], ["box-shadow", "0 0 0 1px rgb(127 127 127 / .22)"]]) s.setProperty(p, val, "important");
      if (it.h) { s.setProperty("height", it.h + "px", "important"); s.setProperty("overflow", "auto", "important"); }
      sizes.observe(el);
    }
    scrollTo(0, 0);
    tags.classList.add("on");
    bar.classList.add("canvas");
    layoutButton.setAttribute("aria-pressed", "true");
    schedule();
    // Fit once layout settles, unless the reader has a camera already or moves it first.
    if (!saved.camera && !touched) {
      const go = () => requestAnimationFrame(() => requestAnimationFrame(() => { if (!touched && layout === "canvas") fit(); }));
      (document.fonts ? document.fonts.ready : Promise.resolve()).then(go, go);
    }
    announce();
    save();
  }
  function leaveCanvas() {
    layout = "picker";
    delete root.dataset.prototypeLayout;
    for (const it of items) {
      if (it.style == null) it.el.removeAttribute("style"); else it.el.setAttribute("style", it.style);
      sizes.unobserve(it.el);
    }
    saved.camera = { ...cam };
    tags.classList.remove("on");
    bar.classList.remove("canvas");
    layoutButton.setAttribute("aria-pressed", "false");
    const i = current < 0 ? 0 : current;
    current = -1;
    show(i);
    save();
  }
  const toggle = () => (layout === "canvas" ? leaveCanvas() : enterCanvas());

  function announce() {
    const el = variants[current] || variants[0];
    const visible = layout === "canvas" ? variants.map((v) => v.id) : [el.id];
    document.dispatchEvent(new CustomEvent("variantchange", { detail: { id: el.id, label: nameOf(el), visible } }));
  }

  function show(i) {
    i = (i + variants.length) % variants.length;
    if (layout === "canvas") reveal(items[i]);
    if (i === current) return;
    current = i;
    if (layout !== "canvas") variants.forEach((el, j) => { el.hidden = j !== i; });
    buttons.forEach((button, j) => button.setAttribute("aria-pressed", String(j === i)));
    buttons[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    const el = variants[i];
    note.textContent = el.dataset.note || "";
    note.hidden = !el.dataset.note;
    label();
    try { localStorage.setItem(key, el.id); } catch {}
    try { history.replaceState(history.state, "", "#" + el.id); } catch {}
    // Comment pins measure their anchors on resize, so they follow the variant that just appeared.
    window.dispatchEvent(new Event("resize"));
    announce();
  }

  $(".prev").onclick = () => show(current - 1);
  $(".next").onclick = () => show(current + 1);
  $(".out").onclick = () => zoomCenter(1 / 1.25);
  $(".in").onclick = () => zoomCenter(1.25);
  $(".fit").onclick = () => fit();
  $(".reset").onclick = reset;
  layoutButton.onclick = toggle;
  function label() {
    const min = bar.classList.contains("min");
    fold.textContent = min ? current + 1 + "/" + variants.length : "–";
    fold.setAttribute("aria-label", min ? "Show the picker" : "Fold the picker");
  }
  fold.onclick = () => { bar.classList.toggle("min"); label(); };
  window.addEventListener("hashchange", () => { const i = find(location.hash.slice(1)); if (i >= 0) show(i); });

  const typing = (t) => t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
  const interactive = (t) => t === host || typing(t) || (t && t.closest && t.closest("a[href], button, summary, [tabindex], [contenteditable]"));
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(t)) return;
    if (e.key === "c" || e.key === "C") { toggle(); e.preventDefault(); return; }
    if (layout === "canvas") {
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
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= variants.length) show(Number(e.key) - 1);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowLeft") show(current - 1);
    else if (e.key === "ArrowRight") show(current + 1);
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= variants.length) show(Number(e.key) - 1);
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
    if (layout !== "canvas" || gesture) return;
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
    if (layout !== "canvas" || e.composedPath().includes(bar)) return;
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
  window.addEventListener("gesturestart", (e) => { if (layout === "canvas") { e.preventDefault(); pinchFrom = cam.z; } });
  window.addEventListener("gesturechange", (e) => { if (layout === "canvas") { e.preventDefault(); zoomAt(pinchFrom * e.scale, e.clientX, e.clientY); } });

  // The page never scrolls under the plane; focus that lands off screen moves the camera instead.
  const unscroll = () => {
    if (layout !== "canvas") return;
    if (scrollX || scrollY) scrollTo(0, 0);
    if (document.body.scrollTop || document.body.scrollLeft) document.body.scrollTop = document.body.scrollLeft = 0;
  };
  window.addEventListener("scroll", unscroll, true);
  document.addEventListener("focusin", (e) => {
    if (layout !== "canvas" || !(e.target instanceof Element) || e.target === host) return;
    unscroll();
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

  document.body.append(host);
  const start = [location.hash.slice(1), remembered()].map(find).find((i) => i >= 0);
  show(start ?? 0);
  if ((saved.layout || document.body.dataset.layout) === "canvas") enterCanvas();
})();
