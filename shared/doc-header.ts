// A Markdown doc's header in the viewer: the properties box at the top (withDocProperties in
// server/utils/markdown-document.ts) takes what the review dock used to hold. Each link gets its site's icon, the drops
// related to this one join its Links row, Copy as Markdown, Download and Export as PDF sit at its top right, and the
// read-only facts (views, file, who dropped it, folder) fold under its last row behind See more.
//
// The frame is on another origin than Drop, so the viewer sends what to show ("doc-header", DocHeader) and the buttons
// ask the viewer to act ("doc-action", "doc-open" in ./frame-messages). Everything goes after the box's own rows, so
// the rows keep the element paths comments anchor to.

type DocHeaderAction = { id: "markdown" | "download" | "pdf"; label: string; kbd?: string }
export type DocHeaderFact = {
  icon: "views" | "file" | "person" | "folder"
  label: string
  value: string
  detail?: string
}
export type DocHeader = {
  actions: DocHeaderAction[]
  copied: boolean
  facts: DocHeaderFact[]
  /** Drops related to this one through the pages they link to (server/utils/related.ts), opened in the viewer. */
  related: { id: string; title: string; href: string }[]
  /** Those drops' links that this doc doesn't list yet. */
  links: { url: string; label: string }[]
  /** Drop's own icon, for the related drops. */
  icon: string
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

// Lucide, as comark-ui's properties draw their rows.
const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chevron: '<path d="m6 9l6 6l6-6"/>',
  markdown: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 15V9l2.5 3L11 9v6m5-6v6m-2-2l2 2l2-2"/>',
  download: '<path d="M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10l5 5l5-5"/>',
  pdf: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 13H8m8 4H8m8-8H8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  views:
    '<path d="M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  person: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
}
const SVGS = Object.fromEntries(Object.entries(ICONS).map(([name, body]) => [name, svg(body)]))
// A row's icon is a mask over the label's color, like the box's own rows (--cfm-icon).
const MASKS = Object.fromEntries(
  (["views", "file", "person", "folder"] as const).map((name) => [
    name,
    `url("data:image/svg+xml,${encodeURIComponent(svg(ICONS[name]).replace("currentColor", "#000"))}")`,
  ]),
)

const CSS = `
.drop-head { position: relative; }
.drop-head.drop-acts > div:first-of-type > dd { padding-right: 7.5rem; }
drop-doc-actions { position: absolute; top: 0; right: 0; display: flex; align-items: center; height: 2rem; user-select: none; }
drop-doc-actions[hidden], drop-doc-more[hidden], drop-doc-facts[hidden] { display: none; }
.drop-split { display: inline-flex; }
.drop-btn { display: inline-flex; align-items: center; gap: .375rem; height: 1.75rem; padding: 0 .625rem; border: 1px solid var(--border); background: var(--background); color: var(--foreground); font: 500 .8125rem/1 var(--font-sans); cursor: pointer; white-space: nowrap; transition: background-color .12s, color .12s, transform .12s; }
.drop-btn:hover { background: var(--accent); }
.drop-btn:active { transform: scale(.97); }
.drop-btn svg { width: .9375rem; height: .9375rem; }
.drop-btn:focus-visible, .drop-more:focus-visible, .drop-menu button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.drop-split > .drop-btn:first-child { border-radius: calc(var(--radius) - 2px) 0 0 calc(var(--radius) - 2px); }
.drop-split > .drop-btn:only-child { border-radius: calc(var(--radius) - 2px); }
.drop-split > .drop-arrow { width: 1.75rem; padding: 0; justify-content: center; border-left: 0; border-radius: 0 calc(var(--radius) - 2px) calc(var(--radius) - 2px) 0; color: var(--muted-foreground); }
.drop-split > .drop-arrow:hover { color: var(--foreground); }
.drop-split > .drop-arrow svg { width: .875rem; height: .875rem; }
.drop-menu { position: absolute; top: 2.25rem; right: 0; z-index: 10; min-width: 13.5rem; padding: .25rem; border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: var(--popover); color: var(--popover-foreground); box-shadow: 0 4px 16px -4px rgb(0 0 0/.12), 0 1px 3px rgb(0 0 0/.06); opacity: 0; transform: translateY(-4px) scale(.98); transform-origin: top right; visibility: hidden; transition: opacity .14s cubic-bezier(.23,1,.32,1), transform .14s cubic-bezier(.23,1,.32,1), visibility 0s .14s; }
.drop-menu.drop-shown { opacity: 1; transform: none; visibility: visible; transition: opacity .14s cubic-bezier(.23,1,.32,1), transform .14s cubic-bezier(.23,1,.32,1); }
.drop-menu button { display: flex; width: 100%; align-items: center; gap: .5rem; height: 2rem; padding: 0 .5rem; border: 0; border-radius: calc(var(--radius) - 4px); background: none; color: inherit; font: 400 .8125rem/1 var(--font-sans); text-align: left; cursor: pointer; }
.drop-menu button:hover, .drop-menu button:focus-visible { background: var(--accent); outline: none; }
.drop-menu svg { width: 1rem; height: 1rem; color: var(--muted-foreground); }
.drop-menu kbd { margin-left: auto; padding: 0 .3rem; border: 1px solid var(--border); border-radius: .25rem; color: var(--muted-foreground); font: 400 .6875rem/1.125rem var(--font-sans); }
drop-doc-more { position: absolute; right: 0; display: flex; align-items: center; height: 2rem; user-select: none; }
.drop-more { display: inline-flex; align-items: center; gap: .25rem; height: 1.75rem; padding: 0 .375rem 0 .5rem; border: 0; border-radius: calc(var(--radius) - 4px); background: none; color: var(--muted-foreground); font: 400 .8125rem/1 var(--font-sans); cursor: pointer; transition: background-color .12s, color .12s; }
.drop-more:hover { background: var(--accent); color: var(--foreground); }
.drop-more svg { width: .875rem; height: .875rem; transition: transform .24s cubic-bezier(.23,1,.32,1); }
.drop-open .drop-more svg { transform: rotate(180deg); }
drop-doc-facts { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .24s cubic-bezier(.23,1,.32,1), opacity .18s cubic-bezier(.23,1,.32,1); }
.drop-open > drop-doc-facts { grid-template-rows: 1fr; opacity: 1; }
drop-doc-facts > div { display: grid; gap: .125rem; min-height: 0; overflow: hidden; }
drop-doc-facts > div > div { display: grid; grid-template-columns: minmax(0, 9rem) minmax(0, 1fr); gap: .5rem; align-items: start; }
.drop-fact-detail { color: var(--muted-foreground); }
@container cfm (max-width: 22rem) {
  drop-doc-facts > div > div { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .drop-head.drop-acts > div:first-of-type > dd { padding-right: 0; }
}
@media (prefers-reduced-motion: reduce) { drop-doc-facts, .drop-more svg, .drop-menu { transition: none; } }
/* A site's icon, drawn for a light tab bar: in the dark theme it sits on a white plate (as ViewerResourceIcon does). */
.drop-favicon { display: inline-block; flex-shrink: 0; width: 1rem; height: 1rem; margin-right: .375rem; border-radius: .1875rem; vertical-align: -.1875rem; object-fit: contain; }
.cfm-tag:has(> a > .drop-favicon) { padding-left: .25rem; }
.cfm-tag > a { display: inline-flex; align-items: center; text-decoration: none; }
span.drop-favicon { color: var(--muted-foreground); }
span.drop-favicon svg { display: block; width: 100%; height: 100%; }
.dark .drop-favicon { background: #fff; box-shadow: 0 0 0 2px #fff; }
.dark span.drop-favicon { color: #737373; }
@media print { drop-doc-actions, drop-doc-more, drop-doc-facts { display: none !important; } .drop-head.drop-acts > div:first-of-type > dd { padding-right: 0; } }
`

/** Runs in a Markdown doc's frame (planDocument in ./documents). */
export const DOC_HEADER_SCRIPT = String.raw`(() => {
  const box = document.querySelector("article > dl.cfm");
  if (!box) return;
  const SVGS = ${JSON.stringify(SVGS)}, MASKS = ${JSON.stringify(MASKS)};
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(CSS)};
  document.head.appendChild(style);
  box.classList.add("drop-head");
  const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
  const el = (tag, props, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  const icon = (name) => { const span = document.createElement("span"); span.innerHTML = SVGS[name]; return span.firstChild; };

  // The site's /favicon.ico, then the domains above it, then a plain link icon (faviconUrls in shared/resources.ts).
  function favicons(href) {
    let url;
    try { url = new URL(href); } catch { return []; }
    if (!/^https?:$/.test(url.protocol)) return [];
    const out = [url.origin + "/favicon.ico"], host = url.hostname;
    if (host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$|^\[/.test(host)) return out;
    const labels = host.split(".");
    for (let start = 1; labels.length - start >= 2; start++) out.push("https://" + labels.slice(start).join(".") + "/favicon.ico");
    return out;
  }
  function withIcon(a, src) {
    if (a.querySelector(".drop-favicon")) return a;
    const tries = src ? [src] : favicons(a.href);
    if (!tries.length) return a;
    let at = 0;
    const img = el("img", { className: "drop-favicon", alt: "", referrerPolicy: "no-referrer", decoding: "async", src: tries[0] });
    img.addEventListener("error", () => {
      if (++at < tries.length) img.src = tries[at];
      else img.replaceWith(el("span", { className: "drop-favicon" }, icon("link")));
    });
    a.prepend(img);
    return a;
  }
  box.querySelectorAll('a[href^="http"]').forEach((a) => withIcon(a));

  const rows = () => Array.from(box.children).filter((child) => child.localName === "div");
  const actions = el("drop-doc-actions", { hidden: true });
  const more = el("drop-doc-more", { hidden: true });
  const facts = el("drop-doc-facts", { hidden: true, id: "drop-doc-facts" });
  box.append(actions, more, facts);

  // The menu: opened by its arrow, closed by a choice, a click elsewhere, or Escape, which stays in the page.
  let menu = null, arrow = null;
  function closeMenu(focus) {
    if (!menu || !menu.classList.contains("drop-shown")) return;
    menu.classList.remove("drop-shown");
    arrow.setAttribute("aria-expanded", "false");
    if (focus) arrow.focus();
  }
  document.addEventListener("click", (e) => { if (menu && !actions.contains(e.target)) closeMenu(false); });
  document.addEventListener("keydown", (e) => {
    if (!menu || !menu.classList.contains("drop-shown")) return;
    const items = Array.from(menu.querySelectorAll("button"));
    const at = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
    else if (e.key === "Tab") closeMenu(false);
  });

  const ACTION_ICONS = { markdown: "markdown", download: "download", pdf: "pdf" };
  function renderActions(list, copied) {
    actions.replaceChildren();
    menu = arrow = null;
    actions.hidden = !list.length;
    box.classList.toggle("drop-acts", list.length > 0);
    if (!list.length) return;
    const first = list[0];
    const copy = first.id === "markdown";
    const main = el("button", { type: "button", className: "drop-btn", title: first.label + (first.kbd ? " (" + first.kbd + ")" : "") },
      icon(copied && copy ? "check" : copy ? "copy" : ACTION_ICONS[first.id]),
      el("span", {}, copied && copy ? "Copied" : copy ? "Copy" : first.id === "download" ? "Download" : "PDF"));
    main.setAttribute("aria-label", first.label);
    main.addEventListener("click", () => post({ type: "doc-action", action: first.id }));
    const split = el("div", { className: "drop-split" }, main);
    if (list.length > 1) {
      arrow = el("button", { type: "button", className: "drop-btn drop-arrow" }, icon("chevron"));
      arrow.setAttribute("aria-label", "More ways to save this doc");
      arrow.setAttribute("aria-haspopup", "menu");
      arrow.setAttribute("aria-expanded", "false");
      arrow.setAttribute("aria-controls", "drop-doc-menu");
      menu = el("div", { className: "drop-menu", id: "drop-doc-menu" });
      menu.setAttribute("role", "menu");
      for (const action of list) {
        const item = el("button", { type: "button" }, icon(ACTION_ICONS[action.id]), action.label);
        item.setAttribute("role", "menuitem");
        if (action.kbd) item.append(el("kbd", {}, action.kbd));
        item.addEventListener("click", () => { closeMenu(true); post({ type: "doc-action", action: action.id }); });
        menu.append(item);
      }
      arrow.addEventListener("click", () => {
        if (menu.classList.contains("drop-shown")) return closeMenu(false);
        menu.classList.add("drop-shown");
        arrow.setAttribute("aria-expanded", "true");
        menu.querySelector("button").focus({ preventScroll: true });
      });
      split.append(arrow);
    }
    actions.append(split);
    if (menu) actions.append(menu);
  }

  // See more sits at the right of the box's last row, beside the buttons when that row is also the first.
  function place() {
    const all = rows();
    const last = all[all.length - 1];
    if (!last || more.hidden) return;
    more.style.top = last.offsetTop + "px";
    more.style.right = last === all[0] && !actions.hidden ? actions.offsetWidth + 8 + "px" : "0px";
  }
  new ResizeObserver(place).observe(box);
  let open = false;
  function renderFacts(list) {
    const wasOpen = open;
    facts.replaceChildren();
    more.replaceChildren();
    more.hidden = facts.hidden = !list.length;
    if (!list.length) return;
    const inner = el("div");
    for (const fact of list) {
      const dd = el("dd", {}, fact.value);
      if (fact.detail) dd.append(el("span", { className: "drop-fact-detail" }, "\u00b7 " + fact.detail));
      // The space after the icon, as the box's own labels get from comark's markup.
      const row = el("div", {}, el("dt", {}, " " + fact.label), dd);
      if (MASKS[fact.icon]) row.style.setProperty("--cfm-icon", MASKS[fact.icon]);
      inner.append(row);
    }
    facts.append(inner);
    const button = el("button", { type: "button", className: "drop-more" }, el("span", {}, "See more"), icon("chevron"));
    button.setAttribute("aria-controls", "drop-doc-facts");
    const set = (value) => {
      open = value;
      box.classList.toggle("drop-open", open);
      button.setAttribute("aria-expanded", String(open));
      button.firstChild.textContent = open ? "See less" : "See more";
      facts.inert = !open;
    };
    button.addEventListener("click", () => set(!open));
    more.append(button);
    set(wasOpen);
    place();
  }

  // Related drops open in the viewer; with a modifier key, in a new tab as any link.
  function renderRelated(related, links, dropIcon) {
    box.querySelectorAll("[data-drop-added]").forEach((node) => node.remove());
    if (!related.length && !links.length) return;
    const has = new Set(Array.from(box.querySelectorAll("a[href]"), (a) => a.href));
    const tags = [];
    for (const drop of related) {
      const a = withIcon(el("a", { href: drop.href }, drop.title), dropIcon);
      a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        post({ type: "doc-open", id: drop.id });
      });
      tags.push(a);
    }
    for (const link of links) if (!has.has(new URL(link.url).href)) tags.push(withIcon(el("a", { href: link.url }, link.label)));
    if (!tags.length) return;
    let dd = box.querySelector(':scope > div[data-key="links"] > dd');
    // One link the box showed becomes several.
    if (dd && /^\s*Link\s*$/.test(dd.previousElementSibling.textContent)) dd.previousElementSibling.textContent = " Links";
    if (!dd) {
      dd = el("dd");
      const row = el("div", {}, el("dt", {}, " Related"), dd);
      row.dataset.key = "links";
      row.dataset.kind = "tags";
      row.dataset.dropAdded = "";
      box.insertBefore(row, actions);
    }
    for (const a of tags) { const tag = el("span", { className: "cfm-tag" }, a); tag.dataset.dropAdded = ""; dd.append(tag); }
    place();
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent || m.type !== "doc-header") return;
    renderActions(Array.isArray(m.actions) ? m.actions.filter((a) => ACTION_ICONS[a.id]) : [], m.copied === true);
    renderRelated(Array.isArray(m.related) ? m.related : [], Array.isArray(m.links) ? m.links : [], typeof m.icon === "string" ? m.icon : "");
    renderFacts(Array.isArray(m.facts) ? m.facts : []);
  });
})()`
