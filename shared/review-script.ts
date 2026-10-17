// What a site under review loads from Drop: /review.js (server/routes/review.js.get.ts). It adds one element, a
// toolbar in a closed shadow root, so the page's CSS can't reach it and it touches nothing else on the page. It does
// nothing until someone presses Comment.
import { ELEMENT_NAMING } from "./plan-runtime";

/** Pinned, and loaded only when someone sends a comment. A page whose CSP blocks it sends comments without a screenshot. */
export const SCREENSHOT_MODULE = "https://esm.sh/modern-screenshot@4.7.0";

const STYLE = `
:host { all: initial; --bg: #fff; --fg: #0a0a0a; --muted: #737373; --border: #e5e5e5; --primary: #171717; --primary-fg: #fafafa; --ring: #a3a3a3; --error: #dc2626; }
@media (prefers-color-scheme: dark) { :host { --bg: #171717; --fg: #fafafa; --muted: #a3a3a3; --border: rgb(255 255 255 / .12); --primary: #e5e5e5; --primary-fg: #171717; --ring: #737373; --error: #f87171; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.ui { font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); -webkit-font-smoothing: antialiased; }
.bar { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); box-shadow: 0 4px 16px rgb(0 0 0 / .12); }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; font-weight: 500; cursor: pointer; }
.btn:hover { background: color-mix(in oklab, var(--fg) 5%, var(--bg)); }
.btn:focus-visible, textarea:focus-visible, .count:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.btn.primary { border-color: var(--primary); background: var(--primary); color: var(--primary-fg); }
.btn.primary:hover { opacity: .9; }
.btn:disabled { opacity: .6; cursor: default; }
.btn svg { width: 16px; height: 16px; fill: currentColor; }
.count { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 12px; background: color-mix(in oklab, var(--fg) 8%, var(--bg)); color: var(--fg); font: 500 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-decoration: none; }
.draw { position: fixed; inset: 0; cursor: crosshair; touch-action: none; background: rgb(0 0 0 / .04); }
.hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); box-shadow: 0 4px 16px rgb(0 0 0 / .12); white-space: nowrap; }
.box { position: fixed; border: 2px solid var(--primary); border-radius: 4px; background: color-mix(in oklab, var(--primary) 10%, transparent); pointer-events: none; }
.pop { position: fixed; width: 320px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); box-shadow: 0 8px 28px rgb(0 0 0 / .16); }
textarea { display: block; width: 100%; min-height: 88px; resize: vertical; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; }
.row { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.who { margin-right: auto; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.msg { margin: 8px 0 0; color: var(--error); font-size: 13px; }
.toast { position: fixed; right: 16px; bottom: 64px; display: flex; gap: 8px; max-width: 360px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); box-shadow: 0 4px 16px rgb(0 0 0 / .12); }
.toast a { color: var(--fg); font-weight: 500; }
`;

const ICON = `<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z"/></svg>`;

const MARKUP = `<div class="ui">
<div class="bar"><button class="btn primary" type="button" data-act="comment">${ICON}Comment</button><a class="count" hidden target="_blank" rel="noopener"></a></div>
<div class="draw" hidden><div class="hint">Drag over what you want to comment on. Esc cancels.</div></div>
<div class="box" hidden></div>
<form class="pop" hidden><textarea aria-label="Comment" maxlength="4000" placeholder="What should change here?"></textarea><p class="msg" role="alert" hidden></p>
<div class="row"><span class="who"></span><button class="btn" type="button" data-act="cancel">Cancel</button><button class="btn primary" type="submit">Send</button></div></form>
<div class="toast" role="status" hidden></div>
</div>`;

/**
 * The review toolbar. Comment opens Drop's connect popup the first time (Drop's origin, Drop's session), which hands
 * back a review token for this origin only; the token stays in sessionStorage. Then drag a box, write, and Send: the
 * script takes a screenshot of the viewport and posts it with the note, the page's address, the element under the box,
 * and the box in thousandths of the viewport. Requests carry the token and never cookies.
 */
export const REVIEW_SCRIPT = String.raw`(() => {
  const script = document.currentScript;
  if (!script || window.__dropReview) return;
  const key = script.getAttribute("data-drop");
  if (!key) { console.warn("Drop review: add data-drop with the site's review key to the script tag."); return; }
  window.__dropReview = true;
  const drop = new URL(script.src).origin;
  const api = drop + "/api/review/" + encodeURIComponent(key) + "/comments";
  const stored = "drop-review:" + drop + ":" + key;
  const MAX_BYTES = 4 * 1024 * 1024;
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
  const $ = (selector) => root.querySelector(selector);
  const bar = $(".bar"), draw = $(".draw"), box = $(".box"), pop = $(".pop"), note = $("textarea"), msg = $(".msg"), who = $(".who"), toast = $(".toast"), count = $(".count");
  const send = pop.querySelector("[type=submit]");
  let area = null, start = null, busy = false, toastTimer = 0;

  function save(value) {
    token = value ? value.token : null;
    try { value ? sessionStorage.setItem(stored, JSON.stringify(value)) : sessionStorage.removeItem(stored); } catch (e) {}
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
      const url = drop + "/review/connect?d=" + encodeURIComponent(key) + "&origin=" + encodeURIComponent(location.origin);
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

  function authorName() {
    try { return (JSON.parse(sessionStorage.getItem(stored) || "null") || {}).name || ""; } catch (e) { return ""; }
  }

  async function refreshCount() {
    if (!token) return;
    try {
      const response = await fetch(api + "?page=" + encodeURIComponent(location.pathname + location.search), { headers: { authorization: "Bearer " + token }, credentials: "omit" });
      if (response.status === 401) return save(null);
      if (!response.ok) return;
      const answer = await response.json();
      const open = answer.comments.filter((comment) => !comment.resolved).length;
      count.hidden = !open;
      count.textContent = String(open);
      count.href = answer.url;
      count.title = open + " open comment" + (open === 1 ? "" : "s") + " on this page. Open the review in Drop.";
    } catch (e) {}
  }

  function place(el, r) {
    el.style.left = r.left + "px"; el.style.top = r.top + "px"; el.style.width = r.width + "px"; el.style.height = r.height + "px";
  }
  const rectOf = (a, b) => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });

  function startDrawing() {
    cancel();
    bar.hidden = true;
    draw.hidden = false;
  }
  function cancel() {
    draw.hidden = true; box.hidden = true; pop.hidden = true; msg.hidden = true; bar.hidden = false;
    area = null; start = null;
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
    const r = rectOf(start, { x: e.clientX, y: e.clientY });
    start = null;
    // A click or a tiny drag draws nothing: keep drawing.
    if (r.width < 6 || r.height < 6) { box.hidden = true; return; }
    draw.hidden = true;
    const el = anchorFor(r.left, r.top, r.right, r.bottom, host);
    area = { rect: r, selector: pathOf(el), label: labelOf(el) };
    const width = Math.min(320, innerWidth - 16);
    pop.style.width = width + "px";
    pop.hidden = false;
    const below = r.bottom + 8 + pop.offsetHeight <= innerHeight;
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - width - 8)) + "px";
    pop.style.top = Math.max(8, below ? r.bottom + 8 : r.top - pop.offsetHeight - 8) + "px";
    who.textContent = authorName() ? "As " + authorName() : "";
    note.focus();
  });
  draw.addEventListener("pointercancel", () => { start = null; box.hidden = true; });

  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (!draw.hidden || !pop.hidden) && !busy) { e.stopPropagation(); cancel(); }
  }, true);
  note.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); pop.requestSubmit(); }
  });

  // modern-screenshot, from a CDN the first time someone sends. The viewport only, without this toolbar.
  let screenshotModule = null;
  async function capture() {
    screenshotModule = screenshotModule || import(${JSON.stringify(SCREENSHOT_MODULE)});
    const { domToBlob } = await screenshotModule;
    const take = (scale, type, quality) => domToBlob(document.documentElement, {
      width: innerWidth, height: innerHeight, scale, type, quality, timeout: 15000,
      filter: (node) => node !== host, features: { restoreScrollPosition: true },
    });
    let shot = await take(Math.min(window.devicePixelRatio || 1, 2), "image/webp", 0.85);
    if (shot.size > MAX_BYTES) shot = await take(1, "image/jpeg", 0.75);
    return shot.size <= MAX_BYTES ? shot : null;
  }

  bar.querySelector("[data-act=comment]").addEventListener("click", async () => {
    if (!token) {
      try { await connect(); }
      catch (error) { if (error.message) say(error.message); return; }
      void refreshCount();
    }
    startDrawing();
  });
  pop.querySelector("[data-act=cancel]").addEventListener("click", cancel);

  pop.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = note.value.trim();
    if (!body || busy || !area) return;
    busy = true; send.disabled = true; send.textContent = "Sending…"; msg.hidden = true;
    try {
      // After a session ended, this click opens the popup again and the note is kept.
      if (!token) await connect();
      const r = area.rect, w = innerWidth, h = innerHeight;
      const at = (value, size) => Math.min(1000, Math.max(0, Math.round((value / size) * 1000)));
      const ox = at(r.left, w), oy = at(r.top, h);
      const data = {
        body: body.slice(0, 4000), page: (location.pathname + location.search + location.hash).slice(0, 1000),
        selector: area.selector.slice(0, 2000), label: area.label.slice(0, 200),
        ox, oy, ow: Math.max(1, Math.min(1000 - ox, at(r.right, w) - ox)), oh: Math.max(1, Math.min(1000 - oy, at(r.bottom, h) - oy)),
        viewport: { width: w, height: h },
      };
      const form = new FormData();
      form.append("data", JSON.stringify(data));
      const shot = await capture().catch(() => null);
      if (shot) form.append("screenshot", shot, "screenshot");
      const response = await fetch(api, { method: "POST", body: form, headers: { authorization: "Bearer " + token }, credentials: "omit" });
      const answer = await response.json().catch(() => ({}));
      if (response.status === 401) { save(null); throw new Error("Your review session ended. Press Send to connect again."); }
      if (!response.ok) throw new Error(answer.message || "Drop didn't take the comment.");
      note.value = "";
      cancel();
      say("Sent as #" + answer.n + ". ", answer.url);
      void refreshCount();
    } catch (error) {
      msg.textContent = (error && error.message) || "Couldn't reach Drop.";
      msg.hidden = !msg.textContent;
    } finally {
      busy = false; send.disabled = false; send.textContent = "Send";
    }
  });

  document.documentElement.appendChild(host);
  void refreshCount();
})();`;
