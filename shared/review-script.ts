// What a site under review loads from Drop: /review.js (server/routes/review.js.get.ts), from a script tag in its
// preview builds or from the "Review with Drop" bookmarklet. It adds one element, a toolbar in a closed shadow root,
// so the page's CSS can't reach it and it touches nothing else on the page. It does nothing until someone presses
// Comment. It carries no key: Drop finds the site drop from the page's origin when someone connects.
import { ELEMENT_NAMING } from "./plan-runtime"

/** Pinned, and loaded only when someone presses Comment. A page whose CSP blocks it sends comments without a screenshot. */
const SCREENSHOT_MODULE = "https://esm.sh/modern-screenshot@4.7.0"

const STYLE = `
:host { all: initial; --bg: #fff; --fg: #0a0a0a; --muted: #737373; --border: #e5e5e5; --primary: #171717; --primary-fg: #fafafa; --ring: #a3a3a3; --error: #dc2626; --soft: color-mix(in oklab, var(--fg) 6%, var(--bg)); }
@media (prefers-color-scheme: dark) { :host { --bg: #171717; --fg: #fafafa; --muted: #a3a3a3; --border: rgb(255 255 255 / .12); --primary: #e5e5e5; --primary-fg: #171717; --ring: #737373; --error: #f87171; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.ui { font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); -webkit-font-smoothing: antialiased; }
.bar { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); box-shadow: 0 4px 16px rgb(0 0 0 / .12); }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; font-weight: 500; cursor: pointer; }
.btn:hover, .icon:hover { background: var(--soft); }
.btn:focus-visible, .icon:focus-visible, textarea:focus-visible, .pin:focus-visible, .row-item:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.btn.primary { border-color: var(--primary); background: var(--primary); color: var(--primary-fg); }
.btn.primary:hover { opacity: .9; }
.btn:disabled, .icon:disabled { opacity: .6; cursor: default; }
.btn svg, .icon svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 18; stroke-linecap: round; stroke-linejoin: round; }
.btn.ghost { border-color: transparent; padding: 0 8px; }
.btn.on { background: var(--soft); }
.icon { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; }
.icon:hover { color: var(--fg); }
.count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--soft); font: 500 11px/18px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; }
.draw { position: fixed; inset: 0; cursor: crosshair; touch-action: none; background: rgb(0 0 0 / .04); }
.hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); box-shadow: 0 4px 16px rgb(0 0 0 / .12); white-space: nowrap; }
.box { position: fixed; border: 2px solid var(--primary); border-radius: 4px; background: color-mix(in oklab, var(--primary) 10%, transparent); pointer-events: none; }
.mark { position: fixed; border: 1.5px dashed var(--primary); border-radius: 4px; pointer-events: none; }
.card { position: fixed; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); box-shadow: 0 8px 28px rgb(0 0 0 / .16); overflow: hidden; }
.pop { width: 320px; padding: 10px; }
.thread { width: 340px; max-height: min(480px, calc(100vh - 32px)); }
.list { right: 16px; bottom: 64px; width: 320px; max-height: min(520px, calc(100vh - 96px)); }
.head { display: flex; align-items: center; gap: 4px; height: 40px; flex: none; padding: 0 6px 0 12px; border-bottom: 1px solid var(--border); }
.head .title { margin-right: auto; font: 500 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .02em; }
.head label { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 12px; cursor: pointer; }
.head a { color: var(--muted); font-size: 12px; text-decoration: none; padding: 0 6px; }
.head a:hover { color: var(--fg); }
.items { flex: 1; min-height: 0; overflow-y: auto; }
.item { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.item:last-child { border-bottom: 0; }
.meta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.meta b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta time { color: var(--muted); font-size: 12px; white-space: nowrap; }
.text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.where { margin: 0 0 6px; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avatar { display: inline-grid; place-items: center; width: 22px; height: 22px; flex: none; overflow: hidden; border-radius: 11px; background: var(--primary); color: var(--primary-fg); font: 600 10px/1 ui-sans-serif, system-ui, sans-serif; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.shots { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.shots a { display: block; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--soft); }
.shots img { display: block; max-width: 144px; max-height: 108px; }
.shots .wide img { max-width: 100%; max-height: 180px; }
.compose { flex: none; padding: 8px; border-top: 1px solid var(--border); }
.pop .compose { padding: 0; border: 0; }
textarea { display: block; width: 100%; min-height: 64px; max-height: 200px; resize: vertical; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; }
.thread textarea { min-height: 40px; }
.files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.files:empty { display: none; }
.file { position: relative; width: 52px; height: 52px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--soft); }
.file img { width: 100%; height: 100%; object-fit: cover; }
.file button { position: absolute; top: 2px; right: 2px; display: grid; place-items: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 9px; background: rgb(0 0 0 / .6); color: #fff; cursor: pointer; }
.file svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 28; stroke-linecap: round; }
.row { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.who { margin-right: auto; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.msg { margin: 6px 0 0; color: var(--error); font-size: 13px; }
.empty { padding: 16px 12px; color: var(--muted); }
.row-item { display: flex; gap: 10px; width: 100%; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--border); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.row-item:hover { background: var(--soft); }
.row-item > span:last-child { min-width: 0; flex: 1; }
.row-item .text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row-item.done { opacity: .6; }
.away { color: var(--muted); font-size: 12px; }
.pins { position: fixed; inset: 0; pointer-events: none; }
.pin { position: fixed; left: 0; top: 0; display: grid; place-items: center; width: 28px; height: 28px; margin: -28px 0 0 0; padding: 0; overflow: hidden; border: 0; border-radius: 14px 14px 14px 3px; background: var(--primary); color: var(--primary-fg); font: 600 11px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; pointer-events: auto; box-shadow: 0 1px 4px rgb(0 0 0 / .3), 0 0 0 2px var(--bg); transition: scale 120ms; transform-origin: bottom left; }
.pin:hover, .pin.open { scale: 1.12; }
.pin img { width: 100%; height: 100%; object-fit: cover; }
.pin.done { opacity: .6; filter: grayscale(1); }
.toast { position: fixed; right: 16px; bottom: 64px; display: flex; gap: 8px; max-width: 360px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); box-shadow: 0 4px 16px rgb(0 0 0 / .12); }
.toast a { color: var(--fg); font-weight: 500; }
`

// Line icons, drawn with the stroke in STYLE. The bubble is Comment, the stack is the list of threads.
const svg = (path: string) => `<svg viewBox="0 0 256 256" aria-hidden="true">${path}</svg>`
const ICONS = {
  comment: svg(`<path d="M128 32a96 96 0 0 0-84 142l-12 42 42-12a96 96 0 1 0 54-172z"/>`),
  list: svg(`<path d="M40 72h176M40 128h176M40 184h112"/>`),
  eye: svg(
    `<path d="M24 128s40-72 104-72 104 72 104 72-40 72-104 72S24 128 24 128z"/><circle cx="128" cy="128" r="28"/>`,
  ),
  image: svg(
    `<rect x="36" y="52" width="184" height="152" rx="16"/><circle cx="96" cy="108" r="16"/><path d="M36 172l52-52 48 48 32-32 52 52"/>`,
  ),
  check: svg(`<path d="M52 136l44 44 108-108"/>`),
  reopen: svg(`<path d="M88 152 40 104l48-48"/><path d="M40 104h112a64 64 0 0 1 0 128h-40"/>`),
  close: svg(`<path d="M68 68l120 120M188 68 68 188"/>`),
}

const COMPOSE = (label: string, placeholder: string, send: string, cancel: boolean) =>
  `<div class="compose"><textarea aria-label="${label}" maxlength="4000" placeholder="${placeholder}"></textarea><div class="files"></div><p class="msg" role="alert" hidden></p>` +
  `<div class="row"><button class="icon" type="button" data-act="attach" title="Add images (or paste them)" aria-label="Add images">${ICONS.image}</button><span class="who"></span>` +
  (cancel ? `<button class="btn ghost" type="button" data-act="cancel">Cancel</button>` : "") +
  `<button class="btn primary" type="submit">${send}</button></div><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></div>`

const MARKUP = `<div class="ui">
<div class="pins"></div>
<div class="mark" hidden></div>
<div class="bar"><button class="btn primary" type="button" data-act="comment">${ICONS.comment}Comment</button><button class="btn ghost" type="button" data-act="list" aria-label="Comments on this page">${ICONS.list}<span class="count"></span></button><button class="icon" type="button" data-act="pins" hidden aria-pressed="true" title="Hide comments" aria-label="Hide comments">${ICONS.eye}</button></div>
<div class="draw" hidden><div class="hint">Click a spot or drag over an area. Esc cancels.</div></div>
<div class="box" hidden></div>
<form class="card pop" hidden>${COMPOSE("Comment", "What should change here?", "Send", true)}</form>
<div class="card thread" role="dialog" hidden><div class="head"><span class="title"></span><button class="icon" type="button" data-act="resolve"></button><button class="icon" type="button" data-act="close" aria-label="Close">${ICONS.close}</button></div><div class="items"></div><form class="reply">${COMPOSE("Reply", "Reply", "Reply", false)}</form></div>
<div class="card list" role="dialog" aria-label="Comments on this page" hidden><div class="head"><span class="title">Comments</span><label><input type="checkbox" data-act="resolved">Resolved</label><a target="_blank" rel="noopener">Open in Drop</a><button class="icon" type="button" data-act="close" aria-label="Close">${ICONS.close}</button></div><div class="items"></div></div>
<div class="toast" role="status" hidden></div>
</div>`

/**
 * The screenshot: `captureViewport(skip)` draws the viewport as the reviewer sees it, without `skip` (the toolbar),
 * with modern-screenshot from a CDN the first time.
 *
 * modern-screenshot draws a clone of the page that isn't scrolled, and shifts its content up by the scroll offset
 * instead, so a sticky header would sit where the page starts and a fixed button would move with the content: both
 * leave the viewport once the page is scrolled. `pinsNow` records where each visible one is on screen, and its `apply`
 * (modern-screenshot's onCloneEachNode) puts the clone there:
 *
 * - a fixed element becomes absolute, at its rect relative to what contains it in the clone, at its current size;
 * - a sticky element becomes relative, offset from where it would be unstuck, so it keeps its space in the flow and
 *   the content below it doesn't move up.
 *
 * Clones only reach the hook without their original, so originals carry a data attribute for the length of a capture.
 * `describe` names the element under a box, and says when it's on a sticky or fixed one, which doesn't scroll. Needs
 * ELEMENT_NAMING's labelOf.
 */
const CAPTURE = String.raw`const MAX_BYTES = 4 * 1024 * 1024;
  let screenshotModule = null;
  // Loaded when someone presses Comment, so the box's screenshot can start the moment it's drawn.
  const loadScreenshot = () => (screenshotModule = screenshotModule || import(${JSON.stringify(SCREENSHOT_MODULE)}));
  async function captureViewport(skip) {
    const pins = pinsNow(skip);
    const drawn = [scrollX, scrollY];
    try {
      const { domToBlob } = await loadScreenshot();
      // If the page scrolled since the box was drawn, the clone is taken where it was drawn, and the page goes back
      // once it's cloned. Cloning takes no paint in between on most pages, so nobody sees the jump.
      const take = (scale, type, quality) => {
        const now = [scrollX, scrollY];
        let away = now[0] !== drawn[0] || now[1] !== drawn[1];
        const back = () => { if (away) { away = false; scrollTo(now[0], now[1]); } };
        if (away) scrollTo(drawn[0], drawn[1]);
        return domToBlob(document.documentElement, {
          width: pins.width, height: pins.height, backgroundColor: pins.background, scale, type, quality, timeout: 15000,
          filter: (node) => node !== skip, features: { restoreScrollPosition: true }, onCloneEachNode: pins.apply, onCloneNode: back,
        }).finally(back);
      };
      let shot = await take(Math.min(window.devicePixelRatio || 1, 2), "image/webp", 0.85);
      if (shot.size > MAX_BYTES) shot = await take(1, "image/jpeg", 0.75);
      return shot.size <= MAX_BYTES ? shot : null;
    } finally {
      pins.release();
    }
  }

  let pinRun = 0;
  const containsAbsolute = (style) => style.position !== "static" || style.transform !== "none" || style.filter !== "none" || style.perspective !== "none"
    || /paint|layout|strict|content/.test(style.contain || "") || /transform|perspective|filter/.test(style.willChange || "");
  // What an absolute element's position counts from in the clone: the nearest ancestor that contains it, or one whose
  // parent is scrolled, since modern-screenshot moves that one with a transform. Null is the screenshot's top left.
  function containerOf(el) {
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      if (containsAbsolute(getComputedStyle(node))) return node;
      const parent = node.parentElement;
      if (parent && (parent.scrollTop || parent.scrollLeft)) return node;
    }
    return null;
  }
  function pinsNow(skip) {
    const attr = "data-drop-pin-" + (++pinRun);
    const found = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (el === skip) continue;
      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (style.visibility === "hidden" || r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      // In a scrolled element, the clone moves its siblings with transforms, which paints them over it unless it's raised.
      const parent = el.parentElement;
      found.push({ el, sticky: style.position === "sticky", rect: r, raise: style.zIndex === "auto" && Boolean(parent && (parent.scrollTop || parent.scrollLeft)) });
    }
    // Where each sticky element would be unstuck: set static, measured, and put back before the browser paints.
    const sticky = found.filter((pin) => pin.sticky);
    const saved = sticky.map((pin) => pin.el.getAttribute("style"));
    sticky.forEach((pin) => pin.el.style.setProperty("position", "static", "important"));
    sticky.forEach((pin) => { pin.from = pin.el.getBoundingClientRect(); });
    sticky.forEach((pin, i) => {
      // Through the style object first: removing the attribute alone left style="" behind in Chrome.
      pin.el.style.removeProperty("position");
      if (pin.el.getAttribute("style") !== saved[i]) saved[i] === null ? pin.el.removeAttribute("style") : pin.el.setAttribute("style", saved[i]);
    });
    found.forEach((pin, i) => {
      if (!pin.sticky) {
        const box = containerOf(pin.el), parent = pin.el.parentElement;
        const at = box ? box.getBoundingClientRect() : { left: 0, top: 0 };
        // A child of a scrolled element gets that scroll as a transform in the clone; this offsets it.
        pin.left = pin.rect.left - (box ? at.left + box.clientLeft : 0) + (parent ? parent.scrollLeft : 0);
        pin.top = pin.rect.top - (box ? at.top + box.clientTop : 0) + (parent ? parent.scrollTop : 0);
      }
      pin.el.setAttribute(attr, String(i));
    });
    const CLEAR = ["inset", "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end", "right", "bottom",
      "margin-block-start", "margin-block-end", "margin-inline-start", "margin-inline-end", "inline-size", "block-size",
      "min-inline-size", "min-block-size", "max-inline-size", "max-block-size"];
    // The canvas takes the root's background, or the body's: in the clone, the body's covers only its own box.
    const paint = (el) => { const color = el ? getComputedStyle(el).backgroundColor : ""; return color && color !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(color) ? color : null; };
    return {
      width: innerWidth,
      height: innerHeight,
      background: paint(document.documentElement) || paint(document.body) || "#ffffff",
      apply(cloned) {
        if (cloned.nodeType !== 1 || !cloned.hasAttribute(attr)) return;
        const pin = found[Number(cloned.getAttribute(attr))];
        cloned.removeAttribute(attr);
        if (!pin) return;
        const style = cloned.style, set = (name, value) => style.setProperty(name, value, "important");
        CLEAR.forEach((name) => style.removeProperty(name));
        if (pin.raise) set("z-index", "1");
        if (pin.sticky) {
          set("position", "relative");
          set("left", (pin.rect.left - pin.from.left) + "px");
          set("top", (pin.rect.top - pin.from.top) + "px");
          return;
        }
        set("position", "absolute");
        set("left", pin.left + "px");
        set("top", pin.top + "px");
        set("width", pin.rect.width + "px");
        set("height", pin.rect.height + "px");
        set("margin", "0");
        set("box-sizing", "border-box");
        set("min-width", "0"); set("min-height", "0"); set("max-width", "none"); set("max-height", "none");
        // Its rect already includes any translate, as in a centered toast.
        set("transform", "none"); set("translate", "none"); set("rotate", "none"); set("scale", "none");
      },
      release() { found.forEach((pin) => pin.el.removeAttribute(attr)); },
    };
  }

  const PINNED_NAMES = { header: "header", nav: "navigation", footer: "footer", aside: "sidebar", button: "button", a: "link", dialog: "dialog" };
  function describe(el) {
    const label = labelOf(el);
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position !== "fixed" && position !== "sticky") continue;
      const role = node.getAttribute("role");
      const what = position + " " + (PINNED_NAMES[node.localName] || (role && /^[a-z]{3,20}$/.test(role) ? role : "element"));
      return node === el ? label + " (" + what + ")" : label + " in a " + what;
    }
    return label;
  }`

/**
 * The review toolbar. Comment opens Drop's connect popup the first time (Drop's origin, Drop's session), which hands
 * back a review token for this origin only; the token stays in sessionStorage. Then click a spot or drag a box, write,
 * add images if they help, and Send: the script takes a screenshot of the viewport as the spot is picked and posts it
 * with the note, the images, the page's address, the element under it with where on it the pin goes, and the box in
 * thousandths of the viewport. Requests carry the token and never cookies. The token is sealed: neither it nor
 * anything Drop answers tells the page which drop the comments go to.
 *
 * Once connected, the page shows its threads the way Figma does: a pin with the author's picture on the element each
 * was left on, found again by its CSS path, that opens the thread to read, reply (with images too), and resolve. A
 * thread whose element isn't on the page any more still shows in the list, with the screenshot it came with.
 */
export const REVIEW_SCRIPT = String.raw`(() => {
  // A bookmarklet adds this script with a plain script element, where currentScript works too.
  const script = document.currentScript || Array.from(document.scripts).find((s) => /\/review\.js(?:[?#]|$)/.test(s.src));
  if (!script || window.__dropReview) return;
  window.__dropReview = true;
  const drop = new URL(script.src).origin;
  const api = drop + "/api/review/comments";
  const stored = "drop-review:" + drop;
  const MAX_IMAGES = 4, MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  let token = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(stored) || "null");
    if (saved && saved.expiresAt > Date.now()) token = saved.token;
  } catch (e) {}

  ${ELEMENT_NAMING}

  const host = document.createElement("drop-review");
  host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = "<style>" + ${JSON.stringify(STYLE)} + "</style>" + ${JSON.stringify(MARKUP)};
  const $ = (selector, from) => (from || root).querySelector(selector);
  const bar = $(".bar"), draw = $(".draw"), box = $(".box"), pop = $(".pop"), toast = $(".toast"), mark = $(".mark");
  const pinLayer = $(".pins"), thread = $(".thread"), list = $(".list"), listItems = $(".items", list);
  const listButton = $("[data-act=list]", bar), pinsButton = $("[data-act=pins]", bar), count = $(".count", bar);
  const showResolved = $("[data-act=resolved]", list);
  let area = null, start = null, busy = false, toastTimer = 0;
  let threads = [], openN = null, pinsShown = true, here = "";
  const pinFor = new Map(), elementFor = new Map(), imageUrls = new Map();

  function save(value) {
    token = value ? value.token : null;
    try { value ? sessionStorage.setItem(stored, JSON.stringify(value)) : sessionStorage.removeItem(stored); } catch (e) {}
    if (!token) { threads = []; render(); }
  }

  function say(text, link) {
    toast.textContent = text;
    if (link) {
      const a = document.createElement("a");
      a.href = link; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open in Drop";
      toast.appendChild(a);
    }
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  // Drop's popup runs on Drop's origin, with Drop's session, and posts the token to this origin only.
  function connect() {
    return new Promise((resolve, reject) => {
      const url = drop + "/review/connect?origin=" + encodeURIComponent(location.origin);
      const popup = window.open(url, "drop-review", "popup,width=480,height=640");
      if (!popup) return reject(new Error("Allow pop-ups from this page to sign in to Drop."));
      let settled = false;
      const done = (error, value) => {
        if (settled) return;
        settled = true;
        removeEventListener("message", onMessage);
        clearInterval(timer);
        error ? reject(error) : resolve(value);
      };
      const onMessage = (e) => {
        if (e.origin !== drop || e.source !== popup || !e.data || e.data.__dropReview !== true) return;
        if (typeof e.data.token !== "string") return done(new Error(String(e.data.error || "Drop didn't connect.")));
        save({ token: e.data.token, expiresAt: Number(e.data.expiresAt) || 0, name: String(e.data.name || "") });
        done(null, e.data.token);
      };
      addEventListener("message", onMessage);
      // Closing the popup without connecting cancels quietly. The wait lets a token posted just before closing arrive.
      const timer = setInterval(() => { if (popup.closed) setTimeout(() => done(new Error("")), 300); }, 500);
    });
  }

  // Drop opens the review from the token, for people it's shared with. The page never learns the review's link.
  const reviewUrl = () => drop + "/review/open#" + encodeURIComponent(token || "");

  function authorName() {
    try { return (JSON.parse(sessionStorage.getItem(stored) || "null") || {}).name || ""; } catch (e) { return ""; }
  }

  // Every request to Drop: the token, never cookies. A 401 means the session ended.
  async function call(path, init) {
    const response = await fetch(path, Object.assign({ credentials: "omit" }, init, { headers: Object.assign({ authorization: "Bearer " + token }, (init && init.headers) || {}) }));
    if (response.status === 401) { save(null); throw new Error("Your review session ended. Connect again to comment."); }
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Drop didn't take that.");
    return response;
  }

  // The words and images a box sends: JSON alone, or multipart when there are images.
  function bodyOf(data, files) {
    if (!files.length) return { body: JSON.stringify(data), headers: { "content-type": "application/json" } };
    const form = new FormData();
    form.append("data", JSON.stringify(data));
    files.forEach((file) => form.append("image", file, file.name || "image"));
    return { body: form };
  }

  // ---- Threads on the page ----

  const pageKey = () => location.pathname + location.search;

  async function refresh() {
    if (!token) return;
    here = pageKey();
    try {
      const response = await call(api + "?page=" + encodeURIComponent(here));
      const answer = await response.json();
      if (here !== pageKey()) return;
      threads = Array.isArray(answer.threads) ? answer.threads : [];
      render();
    } catch (e) {}
  }

  const visible = () => threads.filter((item) => !item.resolved || showResolved.checked);

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map((word) => word[0] || "").join("").toUpperCase() || "?";
  }
  function avatar(person, into) {
    into.textContent = initials(person.name);
    if (!person.image || !/^https:\/\//.test(person.image)) return into;
    const img = document.createElement("img");
    img.alt = ""; img.referrerPolicy = "no-referrer";
    img.onload = () => { into.textContent = ""; into.appendChild(img); };
    img.src = person.image;
    return into;
  }
  function ago(at) {
    const s = Math.max(0, (Date.now() - at) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    if (s < 604800) return Math.floor(s / 86400) + "d";
    return new Date(at).toLocaleDateString();
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The element a thread was left on, found again by its CSS path. Null when the page no longer has it.
  function elementOf(item) {
    if (!item.element) return null;
    const known = elementFor.get(item.n);
    if (known && known.isConnected) return known;
    let found = null;
    try { found = document.querySelector(item.element.selector); } catch (e) {}
    if (found && host.contains(found)) found = null;
    elementFor.set(item.n, found);
    return found;
  }
  function pointOf(item) {
    const target = elementOf(item);
    if (!target) return null;
    const r = target.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return null;
    const spot = item.spot || { x: 0, y: 0 };
    return { x: r.left + (spot.x / 1000) * r.width, y: r.top + (spot.y / 1000) * r.height, rect: r };
  }

  function render() {
    const shown = token ? visible() : [];
    const open = threads.filter((item) => !item.resolved).length;
    pinsButton.hidden = !threads.length;
    count.hidden = !token;
    count.textContent = String(open);
    listButton.title = token ? open + " open comment" + (open === 1 ? "" : "s") + " on this page" : "Show the comments on this page";
    for (const [n, pin] of pinFor) if (!shown.some((item) => item.n === n)) { pin.remove(); pinFor.delete(n); }
    for (const item of shown) {
      let pin = pinFor.get(item.n);
      if (!pin) {
        pin = el("button", "pin");
        pin.type = "button";
        pin.addEventListener("click", (e) => { e.stopPropagation(); openThread(item.n); });
        pinLayer.appendChild(pin);
        pinFor.set(item.n, pin);
      }
      pin.classList.toggle("done", item.resolved);
      pin.setAttribute("aria-label", "Comment #" + item.n + " by " + item.author.name);
      pin.title = "#" + item.n + " " + item.author.name + ": " + item.body.slice(0, 80);
      if (pin.dataset.who !== item.author.name) { pin.dataset.who = item.author.name; pin.textContent = ""; avatar(item.author, pin); }
    }
    if (!list.hidden) renderList();
    if (openN !== null) {
      const item = threads.find((t) => t.n === openN);
      if (item) renderThread(item); else closeThread();
    }
    layout();
  }

  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; layout(); }); };
  function layout() {
    pinLayer.hidden = !pinsShown || !draw.hidden;
    for (const item of threads) {
      const pin = pinFor.get(item.n);
      if (!pin) continue;
      const at = pointOf(item);
      const inView = at && at.x >= -4 && at.y >= 0 && at.x <= innerWidth + 4 && at.y <= innerHeight + 28;
      pin.hidden = !inView;
      // The translate property, not transform: it applies after the open pin's scale, so the pin grows in place.
      if (inView) pin.style.translate = Math.round(at.x) + "px " + Math.round(at.y) + "px";
      pin.classList.toggle("open", item.n === openN);
    }
    const item = openN !== null && threads.find((t) => t.n === openN);
    const at = item && pointOf(item);
    mark.hidden = !at;
    if (at) place(mark, { left: at.rect.left - 3, top: at.rect.top - 3, width: at.rect.width + 6, height: at.rect.height + 6 });
    if (item && !thread.hidden) placeThread(at);
  }

  // Pictures come with the token from /api/review/images, since the page can't send Drop's cookies to /f/.
  function image(id, name, wide) {
    const a = el("a", wide ? "wide" : "");
    a.target = "_blank"; a.rel = "noopener"; a.title = name || "Image";
    const img = el("img"); img.alt = name || "Image";
    a.appendChild(img);
    const known = imageUrls.get(id);
    const show = (url) => { img.src = url; a.href = url; };
    if (known) known.then(show, () => {});
    else {
      const loading = call(drop + "/api/review/images/" + encodeURIComponent(id)).then((r) => r.blob()).then((b) => URL.createObjectURL(b));
      loading.catch(() => imageUrls.delete(id));
      imageUrls.set(id, loading);
      loading.then(show, () => { a.textContent = name || "Image"; });
    }
    return a;
  }
  function images(files, into, wide) {
    if (!files.length) return;
    const row = el("div", "shots");
    files.forEach((file) => row.appendChild(image(file.id, file.filename, wide)));
    into.appendChild(row);
  }

  function entry(person, at, body, files) {
    const item = el("div", "item");
    const meta = el("div", "meta");
    meta.appendChild(avatar(person, el("span", "avatar")));
    meta.appendChild(el("b", "", person.name));
    meta.appendChild(el("time", "", ago(at)));
    item.appendChild(meta);
    item.appendChild(el("p", "text", body));
    images(files, item);
    return item;
  }

  function openThread(n) {
    const item = threads.find((t) => t.n === n);
    if (!item) return;
    cancel();
    list.hidden = true;
    openN = n;
    thread.hidden = false;
    renderThread(item);
    layout();
    $("textarea", thread).focus({ preventScroll: true });
  }
  function closeThread() {
    openN = null; thread.hidden = true; mark.hidden = true;
    replyBox.reset();
    layout();
  }

  function renderThread(item) {
    $(".title", thread).textContent = "#" + item.n + (item.resolved ? " · Resolved" : "");
    const resolve = $("[data-act=resolve]", thread);
    resolve.hidden = !item.canResolve;
    resolve.innerHTML = item.resolved ? ${JSON.stringify(ICONS.reopen)} : ${JSON.stringify(ICONS.check)};
    resolve.title = item.resolved ? "Reopen" : "Resolve";
    resolve.setAttribute("aria-label", resolve.title);
    const items = $(".items", thread);
    const scrolled = items.scrollTop;
    items.textContent = "";
    const first = entry(item.author, item.createdAt, item.body, item.images);
    const placed = pointOf(item);
    if (!placed && item.element && item.element.label) first.insertBefore(el("p", "where", "Was on " + item.element.label), first.children[1]);
    // Without its element on the page, the screenshot shows what it was about.
    if (!placed && item.screenshot) images([{ id: item.screenshot, filename: "Screenshot" }], first, true);
    items.appendChild(first);
    item.replies.forEach((reply) => items.appendChild(entry(reply.author, reply.createdAt, reply.body, reply.images)));
    items.scrollTop = scrolled;
    $(".who", thread).textContent = authorName() ? "As " + authorName() : "";
  }

  function placeThread(at) {
    const width = Math.min(340, innerWidth - 16);
    thread.style.width = width + "px";
    const height = thread.offsetHeight;
    let left, top;
    if (at) {
      left = at.x + 36 + width <= innerWidth - 8 ? at.x + 36 : at.x - width - 12;
      top = at.y - 28;
    } else {
      left = innerWidth - width - 16; top = innerHeight - height - 64;
    }
    thread.style.left = Math.max(8, Math.min(left, innerWidth - width - 8)) + "px";
    thread.style.top = Math.max(8, Math.min(top, innerHeight - height - 8)) + "px";
  }

  function renderList() {
    $("a", list).href = reviewUrl();
    listItems.textContent = "";
    const shown = visible().slice().sort((a, b) => a.n - b.n);
    if (!shown.length) listItems.appendChild(el("p", "empty", threads.length ? "Every comment here is resolved." : "No comments on this page yet."));
    for (const item of shown) {
      const row = el("button", "row-item" + (item.resolved ? " done" : ""));
      row.type = "button";
      row.appendChild(avatar(item.author, el("span", "avatar")));
      const text = el("span");
      const meta = el("span", "meta");
      meta.appendChild(el("b", "", item.author.name));
      meta.appendChild(el("time", "", "#" + item.n + " · " + ago(item.createdAt)));
      text.appendChild(meta);
      text.appendChild(el("span", "text", item.body));
      if (!elementOf(item)) text.appendChild(el("span", "away", item.element ? "Not on the page now" : "No element"));
      row.appendChild(text);
      row.addEventListener("click", () => {
        const target = elementOf(item);
        if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
        openThread(item.n);
      });
      listItems.appendChild(row);
    }
  }

  // ---- Writing: a box with images from a button, a paste, or a drop ----

  function composer(form) {
    const note = $("textarea", form), files = $(".files", form), input = $("input[type=file]", form), msg = $(".msg", form);
    const picked = [];
    const show = (text) => { msg.textContent = text; msg.hidden = !text; };
    function add(incoming) {
      for (const file of incoming) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { show("Images must be PNG, JPEG, WebP, or GIF."); continue; }
        if (file.size > MAX_IMAGE_BYTES) { show((file.name || "An image") + " is over 4 MiB."); continue; }
        if (picked.length >= MAX_IMAGES) { show("At most " + MAX_IMAGES + " images."); break; }
        const url = URL.createObjectURL(file);
        picked.push({ file, url });
      }
      paint();
    }
    function paint() {
      files.textContent = "";
      picked.forEach((item, index) => {
        const chip = el("span", "file");
        const img = el("img"); img.src = item.url; img.alt = item.file.name || "Image";
        const remove = el("button"); remove.type = "button"; remove.setAttribute("aria-label", "Remove image");
        remove.innerHTML = ${JSON.stringify(ICONS.close)};
        remove.addEventListener("click", () => { URL.revokeObjectURL(item.url); picked.splice(index, 1); paint(); });
        chip.appendChild(img); chip.appendChild(remove);
        files.appendChild(chip);
      });
    }
    $("[data-act=attach]", form).addEventListener("click", () => input.click());
    input.addEventListener("change", () => { add(Array.from(input.files || [])); input.value = ""; });
    note.addEventListener("paste", (e) => {
      const pasted = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((file) => file.type.startsWith("image/"));
      if (pasted.length) { e.preventDefault(); add(pasted); }
    });
    form.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); });
    form.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); add(Array.from(e.dataTransfer.files)); } });
    note.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    });
    return {
      note, show,
      files: () => picked.map((item) => item.file),
      reset() { picked.splice(0).forEach((item) => URL.revokeObjectURL(item.url)); paint(); note.value = ""; show(""); },
    };
  }
  const newBox = composer(pop), replyBox = composer($(".reply", thread));
  const send = $("[type=submit]", pop), replySend = $("[type=submit]", thread);

  function place(node, r) {
    node.style.left = r.left + "px"; node.style.top = r.top + "px"; node.style.width = r.width + "px"; node.style.height = r.height + "px";
  }
  const rectOf = (a, b) => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const clamp = (value) => Math.min(1000, Math.max(0, Math.round(value)));

  function startDrawing() {
    cancel();
    closeThread();
    list.hidden = true;
    loadScreenshot().catch(() => { screenshotModule = null; });
    bar.hidden = true;
    draw.hidden = false;
    layout();
  }
  function cancel() {
    draw.hidden = true; box.hidden = true; pop.hidden = true; bar.hidden = false;
    newBox.show("");
    area = null; start = null;
    layout();
  }

  draw.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    draw.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
  });
  draw.addEventListener("pointermove", (e) => {
    if (!start) return;
    const r = rectOf(start, { x: e.clientX, y: e.clientY });
    box.hidden = Math.max(r.width, r.height) < 6;
    place(box, r);
  });
  draw.addEventListener("pointerup", (e) => {
    if (!start) return;
    let r = rectOf(start, { x: e.clientX, y: e.clientY });
    const point = r.width < 6 && r.height < 6 ? { x: e.clientX, y: e.clientY } : null;
    start = null;
    // Drawn over nothing in particular: a thin line. Keep drawing.
    if (!point && (r.width < 6 || r.height < 6)) { box.hidden = true; return; }
    draw.hidden = true;
    let target;
    if (point) {
      // A click comments on the element under it; the screenshot's box is a small square around the spot.
      target = document.elementsFromPoint(point.x, point.y).find((node) => node !== host && node !== document.documentElement) || document.body;
      const half = 20, left = Math.max(0, Math.min(point.x - half, innerWidth - 2 * half)), top = Math.max(0, Math.min(point.y - half, innerHeight - 2 * half));
      r = { left, top, right: left + 2 * half, bottom: top + 2 * half, width: 2 * half, height: 2 * half };
    } else {
      target = anchorFor(r.left, r.top, r.right, r.bottom, host);
    }
    box.hidden = Boolean(point);
    place(box, r);
    const er = target.getBoundingClientRect();
    const pinAt = point || { x: r.left, y: r.top };
    const spot = { x: er.width ? clamp(((pinAt.x - er.left) / er.width) * 1000) : 0, y: er.height ? clamp(((pinAt.y - er.top) / er.height) * 1000) : 0 };
    // The screenshot is of this moment, so it still matches the box if the reviewer scrolls while writing.
    area = { rect: r, viewport: { width: innerWidth, height: innerHeight }, selector: pathOf(target), label: describe(target), spot, shot: capture().catch(() => null) };
    const width = Math.min(320, innerWidth - 16);
    pop.style.width = width + "px";
    pop.hidden = false;
    const anchor = point ? { left: point.x, top: point.y, bottom: point.y } : r;
    const below = anchor.bottom + 8 + pop.offsetHeight <= innerHeight;
    pop.style.left = Math.max(8, Math.min(anchor.left, innerWidth - width - 8)) + "px";
    pop.style.top = Math.max(8, below ? anchor.bottom + 8 : anchor.top - pop.offsetHeight - 8) + "px";
    $(".who", pop).textContent = authorName() ? "As " + authorName() : "";
    newBox.note.focus();
    layout();
  });
  draw.addEventListener("pointercancel", () => { start = null; box.hidden = true; });

  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || busy) return;
    if (!draw.hidden || !pop.hidden) { e.stopPropagation(); cancel(); }
    else if (!thread.hidden) { e.stopPropagation(); closeThread(); }
    else if (!list.hidden) { e.stopPropagation(); list.hidden = true; }
  }, true);

  ${CAPTURE}
  const capture = () => captureViewport(host);

  async function ensureToken() {
    if (token) return;
    await connect();
    void refresh();
  }

  $("[data-act=comment]", bar).addEventListener("click", async () => {
    try { await ensureToken(); }
    catch (error) { if (error.message) say(error.message); return; }
    startDrawing();
  });
  listButton.addEventListener("click", async () => {
    if (list.hidden) {
      try { await ensureToken(); }
      catch (error) { if (error.message) say(error.message); return; }
    }
    list.hidden = !list.hidden;
    if (!list.hidden) { closeThread(); renderList(); }
  });
  // A press anywhere else on the page closes the thread or the list, as in Figma.
  addEventListener("pointerdown", (e) => {
    if (e.composedPath().includes(host)) return;
    if (!thread.hidden) closeThread();
    list.hidden = true;
  }, true);
  pinsButton.addEventListener("click", () => {
    pinsShown = !pinsShown;
    pinsButton.setAttribute("aria-pressed", String(pinsShown));
    pinsButton.title = pinsShown ? "Hide comments" : "Show comments";
    pinsButton.setAttribute("aria-label", pinsButton.title);
    pinsButton.classList.toggle("on", !pinsShown);
    layout();
  });
  showResolved.addEventListener("change", render);
  $("[data-act=close]", list).addEventListener("click", () => { list.hidden = true; });
  $("[data-act=close]", thread).addEventListener("click", closeThread);
  $("[data-act=cancel]", pop).addEventListener("click", cancel);

  $("[data-act=resolve]", thread).addEventListener("click", async () => {
    const item = threads.find((t) => t.n === openN);
    if (!item || busy) return;
    busy = true;
    try {
      await call(api + "/" + item.n, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolved: !item.resolved }) });
      item.resolved = !item.resolved;
      if (item.resolved && !showResolved.checked) { closeThread(); say("Resolved #" + item.n + "."); }
      render();
      void refresh();
    } catch (error) { say((error && error.message) || "Couldn't reach Drop."); }
    finally { busy = false; }
  });

  $(".reply", thread).addEventListener("submit", async (e) => {
    e.preventDefault();
    const item = threads.find((t) => t.n === openN);
    const body = replyBox.note.value.trim();
    if (!item || !body || busy) return;
    busy = true; replySend.disabled = true; replyBox.show("");
    try {
      await ensureToken();
      await call(api + "/" + item.n + "/replies", Object.assign({ method: "POST" }, bodyOf({ body: body.slice(0, 4000) }, replyBox.files())));
      replyBox.reset();
      await refresh();
      const items = $(".items", thread);
      items.scrollTop = items.scrollHeight;
    } catch (error) {
      replyBox.show((error && error.message) || "Couldn't reach Drop.");
    } finally {
      busy = false; replySend.disabled = false;
    }
  });

  pop.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = newBox.note.value.trim();
    if (!body || busy || !area) return;
    busy = true; send.disabled = true; send.textContent = "Sending…"; newBox.show("");
    try {
      // After a session ended, this click opens the popup again and the note is kept.
      await ensureToken();
      const r = area.rect, w = area.viewport.width, h = area.viewport.height;
      const at = (value, size) => clamp((value / size) * 1000);
      const ox = at(r.left, w), oy = at(r.top, h);
      const data = {
        body: body.slice(0, 4000), page: (location.pathname + location.search + location.hash).slice(0, 1000),
        selector: area.selector.slice(0, 2000), label: area.label.slice(0, 200), spot: area.spot,
        ox, oy, ow: Math.max(1, Math.min(1000 - ox, at(r.right, w) - ox)), oh: Math.max(1, Math.min(1000 - oy, at(r.bottom, h) - oy)),
        viewport: { width: w, height: h },
      };
      const form = new FormData();
      form.append("data", JSON.stringify(data));
      const shot = await area.shot;
      if (shot) form.append("screenshot", shot, "screenshot");
      newBox.files().forEach((file) => form.append("image", file, file.name || "image"));
      const response = await fetch(api, { method: "POST", body: form, headers: { authorization: "Bearer " + token }, credentials: "omit" });
      const answer = await response.json().catch(() => ({}));
      if (response.status === 401) { save(null); throw new Error("Your review session ended. Press Send to connect again."); }
      if (!response.ok) throw new Error(answer.message || "Drop didn't take the comment.");
      newBox.reset();
      cancel();
      say("Sent as #" + answer.n + ". ", reviewUrl());
      void refresh();
    } catch (error) {
      newBox.show((error && error.message) || "Couldn't reach Drop.");
    } finally {
      busy = false; send.disabled = false; send.textContent = "Send";
    }
  });

  // Pins follow their elements: on scroll anywhere, on resize, and when the page changes under them.
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule, { passive: true });
  new MutationObserver((records) => {
    if (records.every((record) => host === record.target || host.contains(record.target))) return;
    elementFor.clear();
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  // A single-page app changes the address without a load: each new page has its own threads.
  setInterval(() => {
    if (token && pageKey() !== here) { closeThread(); elementFor.clear(); void refresh(); }
    else schedule();
  }, 1000);
  // Other reviewers' new threads and replies show up while someone looks.
  setInterval(() => { if (token && document.visibilityState === "visible" && !busy) void refresh(); }, 30000);
  addEventListener("focus", () => { if (token) void refresh(); });

  document.documentElement.appendChild(host);
  void refresh();
})();`
