// What a site under review loads from Drop: /review.js (server/routes/review.js.get.ts), from a script tag in its
// preview builds or from the "Review with Drop" bookmarklet. It adds one element, a toolbar in a closed shadow root,
// so the page's CSS can't reach it and it touches nothing else on the page. Presses, focus, and keys inside it stop at
// that element, so the page doesn't take them for its own: a menu it has open stays open while someone comments on it.
// It does nothing until someone presses Comment or Highlight. It carries no key: Drop finds the site drop from the
// page's origin when someone connects.
//
// The toolbar is ViteHub's page pill, the same code as ViteHub's page tools (vite-hub/vitehub#3377): it docks to
// any edge, its mark drags it there and collapses it to the hexagon, and the browser remembers both for the site. The
// script tag sets where it starts: data-edge (top, right, bottom, left), data-at (0 to 100 along it), data-collapsed.
// The bookmarklet has no tag, so it starts at the bottom middle.
import PAGE_PILL from "vite-hub/page/pill.js?raw"
import DROP_MARK from "./drop-mark.svg?raw"
import { ELEMENT_NAMING, INK } from "./plan-runtime"
import { MARK_COLORS, MARK_TIPS } from "./utils/marker"
import { CAPTURE } from "./viewport-capture"

const STYLE = `
:host { all: initial; --bg: #fff; --fg: #0a0a0a; --muted: #737373; --border: #e5e5e5; --primary: #171717; --primary-fg: #fafafa; --ring: #a3a3a3; --error: #dc2626; --soft: color-mix(in oklab, var(--fg) 6%, var(--bg)); }
@media (prefers-color-scheme: dark) { :host { --bg: #171717; --fg: #fafafa; --muted: #a3a3a3; --border: rgb(255 255 255 / .12); --primary: #e5e5e5; --primary-fg: #171717; --ring: #737373; --error: #f87171; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.ui { font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); -webkit-font-smoothing: antialiased; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; font-weight: 500; cursor: pointer; }
.btn:hover, .icon:hover { background: var(--soft); }
.btn:focus-visible, .icon:focus-visible, textarea:focus-visible, .pin:focus-visible, .row-item:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.btn.primary { border-color: var(--primary); background: var(--primary); color: var(--primary-fg); }
.btn.primary:hover { opacity: .9; }
.btn:disabled, .icon:disabled { opacity: .6; cursor: default; }
.btn svg, .icon svg, .seg svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 18; stroke-linecap: round; stroke-linejoin: round; }
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
.list { width: 320px; max-height: min(520px, calc(100vh - 96px)); }
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
.row { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
.row .icon { margin-left: -2px; }
.who { flex: 1; min-width: 0; padding-left: 2px; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
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
.toast { position: fixed; display: flex; gap: 8px; max-width: 360px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); box-shadow: 0 4px 16px rgb(0 0 0 / .12); }
.toast a { color: var(--fg); font-weight: 500; }
.icon[aria-pressed=true] { background: var(--soft); color: var(--fg); }
.dot { display: block; border-radius: 50%; }
.swatch { width: 14px; height: 14px; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .2); }
/* The toolbar's segments, in the pill: its buttons, a separator across the flow, and Done as the one filled button. */
.seg .sep { width: 1px; height: 16px; margin: 0 3px; flex: none; background: var(--vitehub-pill-line); }
drop-review-pill:is([edge=left], [edge=right]) .seg .sep { width: 16px; height: 1px; margin: 3px 0; }
.seg .count { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--vitehub-pill-hover); font: 500 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; }
.seg .go { background: var(--vitehub-pill-on); color: var(--vitehub-pill-on-text); }
.seg .go:disabled { opacity: .5; cursor: default; }
.paint { position: fixed; inset: 0; cursor: crosshair; touch-action: none; }
.inked, .ink { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; pointer-events: none; }
.ink path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.ink .mk { stroke-opacity: .4; stroke-linecap: butt; }
`

// Line icons, drawn with the stroke in STYLE. The bubble is Comment, the stack is the list of threads, and the marker,
// pen, and arrow are Highlight's tips.
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
  link: svg(
    `<path d="M116 140a44 44 0 0 0 62 0l36-36a44 44 0 0 0-62-62l-14 14"/><path d="M140 116a44 44 0 0 0-62 0l-36 36a44 44 0 0 0 62 62l14-14"/>`,
  ),
  marker: svg(`<path d="M164 44l48 48-96 96-56 8 8-56z"/><path d="M140 68l48 48"/><path d="M40 220h88"/>`),
  pen: svg(`<path d="M180 36l40 40L92 204l-52 12 12-52z"/>`),
  arrow: svg(`<path d="M60 196 192 64"/><path d="M96 64h96v96"/>`),
}

const COMPOSE = (label: string, placeholder: string, send: string, cancel: boolean) =>
  `<div class="compose"><textarea aria-label="${label}" maxlength="4000" placeholder="${placeholder}"></textarea><div class="files"></div><p class="msg" role="alert" hidden></p>` +
  `<div class="row"><button class="icon" type="button" data-act="attach" title="Add images (or paste them)" aria-label="Add images">${ICONS.image}</button><span class="who"></span>` +
  (cancel ? `<button class="btn ghost" type="button" data-act="cancel">Cancel</button>` : "") +
  `<button class="btn primary" type="submit" aria-keyshortcuts="Meta+Enter Control+Enter">${send}</button>` +
  `</div><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></div>`

// Highlight's controls, in place of the toolbar while someone draws: the tips, four sizes, the colours, Undo, Cancel,
// and Done. The script sizes and colours the dots.
const SEPARATOR = `<span class="sep" aria-hidden="true"></span>`
const TOOLS =
  `<div class="seg tools" slot="highlight" role="group" aria-label="Highlight" hidden>` +
  Object.entries(MARK_TIPS)
    .map(([id, tip]) => {
      // SAFETY: id is an own key of the local MARK_TIPS literal, and ICONS defines an icon for every tip.
      return `<button class="icon" type="button" data-tip="${id}" aria-keyshortcuts="${tip.key}" aria-label="${tip.label}" title="${tip.label} (${tip.key})">${ICONS[id as keyof typeof MARK_TIPS]}</button>`
    })
    .join("") +
  SEPARATOR +
  [0, 1, 2, 3]
    .map((index) => `<button class="icon" type="button" data-size="${index}"><span class="dot"></span></button>`)
    .join("") +
  SEPARATOR +
  Object.keys(MARK_COLORS)
    .map((name) => {
      const label = `${name[0]!.toUpperCase()}${name.slice(1)} ink`
      return `<button class="icon" type="button" data-color="${name}" aria-label="${label}" title="${label}"><span class="dot swatch"></span></button>`
    })
    .join("") +
  SEPARATOR +
  `<button class="icon" type="button" data-act="undo" aria-keyshortcuts="Meta+Z Control+Z" aria-label="Undo" title="Undo" disabled>${ICONS.reopen}</button>` +
  `<button type="button" data-act="cancel">Cancel</button><button class="go" type="button" data-act="done" aria-keyshortcuts="Enter" disabled>Done</button></div>`

const MARKUP = `<div class="ui">
<div class="pins"></div>
<div class="mark" hidden></div>
<div class="inked" hidden><svg class="ink"></svg></div>
<div class="seg bar" slot="review"><button type="button" data-act="comment">${ICONS.comment}Comment</button><button type="button" data-act="mark" title="Draw on the page with a marker, a pen, or arrows">${ICONS.marker}Highlight</button><button type="button" data-act="list" hidden>${ICONS.list}<span class="count"></span></button><button type="button" data-act="copy" hidden title="Copy the review's link" aria-label="Copy the review's link">${ICONS.link}</button><button type="button" data-act="pins" hidden aria-pressed="false" title="Hide comments" aria-label="Hide comments">${ICONS.eye}</button></div>
<div class="draw" hidden><div class="hint">Click a spot or drag over an area. Esc cancels.</div></div>
<div class="box" hidden></div>
<div class="paint" hidden><div class="hint">Draw on what should change. Shift draws straight, Enter when done, Esc cancels.</div></div>
${TOOLS}
<form class="card pop" hidden>${COMPOSE("Comment", "What should change here?", "Send", true)}</form>
<div class="card thread" role="dialog" hidden><div class="head"><span class="title"></span><button class="icon" type="button" data-act="resolve"></button><button class="icon" type="button" data-act="close" aria-label="Close">${ICONS.close}</button></div><div class="items"></div><form class="reply">${COMPOSE("Reply", "Reply", "Reply", false)}</form></div>
<div class="card list" role="dialog" aria-label="Comments on this page" hidden><div class="head"><span class="title">Comments</span><label><input type="checkbox" data-act="resolved">Resolved</label><a target="_blank" rel="noopener">Open in Drop</a><button class="icon" type="button" data-act="close" aria-label="Close">${ICONS.close}</button></div><div class="items"></div></div>
<div class="toast" role="status" hidden></div>
</div>`

/**
 * The review toolbar. Comment opens Drop's connect popup the first time (Drop's origin, Drop's session), which hands
 * back a review token for this origin only; the token stays in sessionStorage. Then click a spot or drag a box, write,
 * add images if they help, and Send: the script takes a screenshot of the viewport as the spot is picked and posts it
 * with the note, the images, the page's address, the element under it with where on it the pin goes, and the box in
 * thousandths of the viewport. Requests carry the token and never cookies. The token is sealed: neither it nor
 * anything Drop answers tells the page which drop the comments go to.
 *
 * Highlight draws on the page instead: a marker, a pen, or arrows, on a screenshot taken as it opens, while the page
 * holds still. Done anchors the comment to the smallest element under the strokes and sends the screenshot with the
 * strokes on it; the strokes stay on the page, scrolling with it, while the note is written.
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

  ${PAGE_PILL}

  const host = document.createElement("drop-review");
  host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  // The segments' buttons look like the pill's own, from the same styles.
  root.innerHTML = "<style>" + ${JSON.stringify(STYLE)} + ".seg{" + ViteHubPagePill.viteHubPillButtonStyles + "}</style>" + ${JSON.stringify(MARKUP)};
  const $ = (selector, from) => (from || root).querySelector(selector);
  const bar = $(".bar"), draw = $(".draw"), box = $(".box"), pop = $(".pop"), toast = $(".toast"), mark = $(".mark");
  const pinLayer = $(".pins"), thread = $(".thread"), list = $(".list"), listItems = $(".items", list);
  const listButton = $("[data-act=list]", bar), pinsButton = $("[data-act=pins]", bar), count = $(".count", bar);
  const copyButton = $("[data-act=copy]", bar);
  const showResolved = $("[data-act=resolved]", list);
  const tools = $(".tools"), paint = $(".paint"), inked = $(".inked"), ink = $(".ink", inked);

  // The comment list and the notes open beside the pill, on its edge, at the end of the edge it is nearer to.
  function dockCards(place) {
    const side = place.edge === "left" || place.edge === "right";
    const off = (place.collapsed ? 2 : 16) + place.thickness + 8 + "px";
    for (const card of [list, toast]) {
      const style = card.style;
      style.left = style.right = style.top = style.bottom = style.translate = "";
      style[place.edge] = off;
      const start = side ? "top" : "left", end = side ? "bottom" : "right";
      if (place.at === 50) { style[start] = "50%"; style.translate = side ? "0 -50%" : "-50% 0"; }
      else style[place.at < 50 ? start : end] = "16px";
    }
  }
  // The pill sits in this shadow root with the rest of the toolbar, so the page reaches none of it, screenshots leave
  // it out, and a press on it stays here. The tag's place is where it starts until the reviewer moves it.
  const dropMark = new DOMParser().parseFromString(${JSON.stringify(DROP_MARK.replace(/<title>[^<]*<\/title>|<metadata>[^<]*<\/metadata>/g, ""))}, "image/svg+xml").documentElement;
  dropMark.setAttribute("aria-hidden", "true");
  const pill = ViteHubPagePill.mountViteHubPagePill({
    name: "drop-review-pill",
    label: "Drop review tools",
    mark: document.importNode(dropMark, true),
    slots: ["review", "highlight"],
    storage: { collapsed: "drop-review-collapsed", dock: "drop-review-dock" },
    initial: {
      dock: ViteHubPagePill.readViteHubPageDock({ edge: script.dataset.edge || "bottom", at: Number(script.dataset.at || 50) }),
      collapsed: script.hasAttribute("data-collapsed"),
    },
    onPlace: dockCards,
    parent: $(".ui"),
    signal: new AbortController().signal,
  });
  pill.append(bar, tools);
  let area = null, start = null, busy = false, toastTimer = 0;
  let threads = [], openN = null, pinsShown = true, here = "";
  let strokes = [], forgetStroke = () => {}, still = null, inkAt = { x: 0, y: 0 };
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
  // Copy link goes through Drop the same way: a small Drop window copies the link there and closes.
  function copyReviewLink() {
    const url = drop + "/review/open?copy#" + encodeURIComponent(token || "");
    if (!window.open(url, "drop-review-copy", "popup,width=420,height=360")) say("Allow pop-ups from this page to copy the review's link.");
  }

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
    // The list shows once the page has threads: before someone connects there is nothing to count.
    copyButton.hidden = pinsButton.hidden = listButton.hidden = !threads.length;
    if (listButton.hidden) list.hidden = true;
    count.textContent = String(open);
    listButton.title = open + " open comment" + (open === 1 ? "" : "s") + " on this page";
    listButton.setAttribute("aria-label", listButton.title);
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
    pinLayer.hidden = !pinsShown || !draw.hidden || !paint.hidden;
    if (!inked.hidden) inked.style.translate = inkAt.x - scrollX + "px " + (inkAt.y - scrollY) + "px";
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
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const submit = $("[type=submit]", form);
    submit.title = submit.textContent + " (" + (isMac ? "⌘" : "Ctrl+") + "Enter)";
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
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); e.stopPropagation(); form.requestSubmit(); }
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
    pill.hidden = true;
    draw.hidden = false;
    layout();
  }
  function cancel() {
    const wasOpen = !draw.hidden || !pop.hidden;
    draw.hidden = true; box.hidden = true; pop.hidden = true; pill.hidden = bar.hidden = false;
    paint.hidden = true; tools.hidden = true; inked.hidden = true; ink.textContent = "";
    newBox.show("");
    area = null; start = null; strokes = []; still = null;
    forgetStroke();
    layout();
    if (wasOpen) $("[data-act=comment]", bar).focus({ preventScroll: true });
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
    // The screenshot is of this moment, so it still matches the box if the reviewer scrolls while writing.
    compose(r, target, point, capture().catch(() => null));
  });
  draw.addEventListener("pointercancel", () => { start = null; box.hidden = true; });

  // The note for an area: point is a click's spot, or null for a box or strokes, whose pin goes on its corner.
  function compose(r, target, point, shot) {
    const er = target.getBoundingClientRect();
    const pinAt = point || { x: r.left, y: r.top };
    const spot = { x: er.width ? clamp(((pinAt.x - er.left) / er.width) * 1000) : 0, y: er.height ? clamp(((pinAt.y - er.top) / er.height) * 1000) : 0 };
    area = { rect: r, viewport: { width: innerWidth, height: innerHeight }, selector: pathOf(target), label: describe(target), spot, shot };
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
  }

  // ---- Highlighting: a marker, a pen, and arrows on a screenshot of the page ----

  ${INK}
  const TIPS = ${JSON.stringify(MARK_TIPS)}, COLORS = ${JSON.stringify(MARK_COLORS)}, DOTS = [5, 8, 11, 15];
  const tip = { name: "marker", color: "pink", sizes: { marker: 1, pen: 1, arrow: 1 } };
  const penNow = () => ({ tool: tip.name, color: COLORS[tip.color], width: TIPS[tip.name].sizes[tip.sizes[tip.name]] });
  tools.querySelectorAll("[data-color]").forEach((button) => { button.firstChild.style.background = COLORS[button.dataset.color]; });

  function paintTools() {
    const sizes = TIPS[tip.name].sizes;
    tools.querySelectorAll("[data-tip]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.tip === tip.name)));
    tools.querySelectorAll("[data-color]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.color === tip.color)));
    tools.querySelectorAll("[data-size]").forEach((button) => {
      const index = Number(button.dataset.size), dot = button.firstChild;
      button.setAttribute("aria-pressed", String(tip.sizes[tip.name] === index));
      button.title = sizes[index] + "px";
      button.setAttribute("aria-label", "Size " + (index + 1) + " of " + sizes.length + ", " + sizes[index] + " pixels");
      dot.style.width = dot.style.height = DOTS[index] + "px";
      dot.style.background = COLORS[tip.color];
      dot.style.opacity = tip.name === "marker" ? ".55" : "1";
    });
    $("[data-act=undo]", tools).disabled = $("[data-act=done]", tools).disabled = !strokes.length;
    paint.style.cursor = penCursor(penNow());
  }

  function startMarking() {
    cancel();
    closeThread();
    list.hidden = true;
    // The screenshot starts now, with the page as the reviewer marks it; it holds still until Done.
    still = capture().catch(() => null);
    inkAt = { x: scrollX, y: scrollY };
    bar.hidden = true;
    tools.hidden = paint.hidden = inked.hidden = false;
    paintTools();
    layout();
  }

  forgetStroke = takeStrokes(paint, ink, penNow, (s) => {
    strokes.push(s);
    paintTools();
  });

  function undoMark() {
    const s = strokes.pop();
    if (s) s.el.remove();
    paintTools();
  }
  function pickTip(name) { tip.name = name; paintTools(); }
  function stepSize(by) {
    tip.sizes[tip.name] = Math.max(0, Math.min(TIPS[tip.name].sizes.length - 1, tip.sizes[tip.name] + by));
    paintTools();
  }

  // The screenshot with the strokes on it, as the reviewer saw them.
  async function withInk(picture, list) {
    const image = await createImageBitmap(picture), k = image.width / innerWidth;
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const g = canvas.getContext("2d");
    g.drawImage(image, 0, 0);
    g.scale(k, k);
    inkOn(g, list);
    const blob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    let out = await blob("image/webp", 0.9);
    if (!out || out.size > MAX_BYTES) out = await blob("image/jpeg", 0.8);
    return out && out.size <= MAX_BYTES ? out : picture;
  }

  function finishMark() {
    if (!strokes.length) return;
    const list = strokes.slice(), picture = still;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const s of list) {
      // The rendered path includes an arrow's bow and head, beyond its pointer endpoints.
      const b = s.el.getBBox(), pad = s.width / 2 + 2;
      left = Math.min(left, b.x - pad); top = Math.min(top, b.y - pad); right = Math.max(right, b.x + b.width + pad); bottom = Math.max(bottom, b.y + b.height + pad);
    }
    const r = rectOf({ x: Math.max(0, left), y: Math.max(0, top) }, { x: Math.min(innerWidth, right), y: Math.min(innerHeight, bottom) });
    paint.hidden = tools.hidden = pill.hidden = true;
    const target = anchorFor(r.left, r.top, r.right, r.bottom, host);
    compose(r, target, null, picture.then((taken) => taken && withInk(taken, list).catch(() => taken)));
  }

  $("[data-act=mark]", bar).addEventListener("click", async () => {
    try { await ensureToken(); }
    catch (error) { if (error.message) say(error.message); return; }
    startMarking();
  });
  tools.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.tip) pickTip(button.dataset.tip);
    else if (button.dataset.size) { tip.sizes[tip.name] = Number(button.dataset.size); paintTools(); }
    else if (button.dataset.color) { tip.color = button.dataset.color; paintTools(); }
    else if (button.dataset.act === "undo") undoMark();
    else if (button.dataset.act === "cancel") cancel();
    else if (button.dataset.act === "done") finishMark();
  });

  addEventListener("keydown", (e) => {
    // While someone draws, the tips' keys, [ and ] for the size, Undo, Enter, and Esc are Highlight's, not the page's.
    if (!paint.hidden) {
      // The screenshot and strokes use viewport coordinates, so native scroll keys must also stay here.
      if (/^( |ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End)$/.test(e.key)) {
        e.preventDefault(); e.stopPropagation(); return;
      }
      const key = e.key.toLowerCase(), command = e.metaKey || e.ctrlKey;
      const named = Object.keys(TIPS).find((name) => TIPS[name].key.toLowerCase() === key);
      if (e.key === "Escape") cancel();
      else if (e.key === "Enter") finishMark();
      else if (command && key === "z") undoMark();
      else if (command || e.altKey) return;
      else if (named) pickTip(named);
      else if (e.key === "[" || e.key === "]") stepSize(e.key === "]" ? 1 : -1);
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== "Escape" || busy || e.isComposing) return;
    if (!draw.hidden || !pop.hidden) { e.preventDefault(); e.stopPropagation(); cancel(); }
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
  listButton.addEventListener("click", () => {
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
    // Pressed while the comments are hidden, like any mode the pill has on.
    pinsButton.setAttribute("aria-pressed", String(!pinsShown));
    pinsButton.title = pinsShown ? "Hide comments" : "Show comments";
    pinsButton.setAttribute("aria-label", pinsButton.title);
    layout();
  });
  showResolved.addEventListener("change", render);
  $("[data-act=close]", list).addEventListener("click", () => { list.hidden = true; });
  copyButton.addEventListener("click", copyReviewLink);
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

  // While Drop restarts or moves to another machine, the proxy in front of it answers without CORS headers, so the
  // browser only sees a failed fetch. That can't tell a comment that never arrived from one Drop saved before the
  // answer was lost. So before each resend the script looks for its request id among the page's threads. Matching
  // words could belong to another reviewer or an older comment. It keeps trying for two minutes; the note stays if
  // it gives up.
  const RETRY_FOR = 120000;
  const unreachable = (response) => !response || response.status === 502 || response.status === 503 || response.status === 504;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function postComment(form, data) {
    const until = Date.now() + RETRY_FOR;
    const attempt = () => fetch(api, { method: "POST", body: form, headers: { authorization: "Bearer " + token }, credentials: "omit" }).catch(() => null);
    let response = await attempt();
    for (let wait = 2000; unreachable(response); wait = Math.min(wait * 2, 15000)) {
      if (Date.now() + wait > until) throw new Error("Couldn't reach Drop. Your comment is still here: press Send to try again.");
      newBox.show("Can't reach Drop. Trying again…");
      await pause(wait);
      const n = await landed(data.page, data.requestId);
      if (n) return { n };
      // undefined: Drop is still out of reach, so wait again. null: Drop answered and the comment isn't there.
      if (n === null) response = await attempt();
    }
    const answer = await response.json().catch(() => ({}));
    if (response.status === 401) { save(null); throw new Error("Your review session ended. Press Send to connect again."); }
    if (!response.ok) throw new Error(answer.message || "Drop didn't take the comment.");
    return answer;
  }

  async function landed(page, requestId) {
    try {
      const response = await fetch(api + "?page=" + encodeURIComponent(page), { headers: { authorization: "Bearer " + token }, credentials: "omit" });
      // A session that ended goes to the resend, whose 401 says so.
      if (response.status === 401) return null;
      if (!response.ok) return undefined;
      const answer = await response.json();
      const found = (Array.isArray(answer.threads) ? answer.threads : []).find((item) => item.requestId === requestId);
      return found ? found.n : null;
    } catch (e) {
      return undefined;
    }
  }

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
        requestId: crypto.randomUUID(),
        selector: area.selector.slice(0, 2000), label: area.label.slice(0, 200), spot: area.spot,
        ox, oy, ow: Math.max(1, Math.min(1000 - ox, at(r.right, w) - ox)), oh: Math.max(1, Math.min(1000 - oy, at(r.bottom, h) - oy)),
        viewport: { width: w, height: h },
      };
      const form = new FormData();
      form.append("data", JSON.stringify(data));
      const shot = await area.shot;
      if (shot) form.append("screenshot", shot, "screenshot");
      newBox.files().forEach((file) => form.append("image", file, file.name || "image"));
      const answer = await postComment(form, data);
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

  // A page's menus and popovers close on a press or focus outside them, which they listen for on the document (Reka
  // UI, Radix). Stopped here, after the toolbar's own listeners, so commenting on an open menu keeps it open, and
  // typing a note doesn't run the page's shortcuts.
  for (const type of ["pointerdown", "mousedown", "touchstart", "click", "focusin", "focusout", "keydown", "keyup"])
    host.addEventListener(type, (e) => e.stopPropagation());
  document.documentElement.appendChild(host);
  void refresh();
})();`
