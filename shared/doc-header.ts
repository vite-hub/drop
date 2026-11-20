// A Markdown doc's header in the viewer: the properties box at the top (withDocProperties in
// server/utils/markdown-document.ts) takes what the review dock used to hold. Its links are comark-chips' chips with
// their site's icon (from Drop, server/utils/favicons.ts), the drops related to this one join its Links row as more chips, Copy as Markdown, Download and Export as PDF sit at its top right, and the
// read-only facts (views, file, who dropped it, folder) fold under its last row behind See more.
//
// The frame is on another origin than Drop, so the viewer sends what to show ("doc-header", DocHeader) and the buttons
// ask the viewer to act ("doc-action", "doc-open" in ./frame-messages). Everything goes after the box's own rows, so
// the rows keep the element paths comments anchor to.
//
// Copy writes the clipboard here, in the click that asked for it: the frame has the click's activation, and the
// viewer's Markdown arrives ahead of it ("doc-intent" on hover or focus, answered with "doc-markdown"). Before it has
// arrived, the write takes a promise of it. A frame without the Clipboard API asks the viewer to copy instead.
import ICON_SWAP_CSS from "@vite-hub/ui/icon-swap.css?raw"

type DocHeaderAction = { id: "markdown" | "download" | "pdf"; label: string; kbd?: string }
/** A person with the agent that acted for them: "[avatar] Max · [logo] Claude Code", the rest on hover. */
export type DocHeaderWho = {
  name: string
  image: string | null
  agent?: { label: string; logo: string }
  /** On hover: through what, the model, the reasoning level. */
  tip?: string
}
export type DocHeaderFact = {
  icon: "views" | "file" | "person" | "folder"
  label: string
  value: string
  detail?: string
  /** Small icon-and-number pairs after the value, each saying what it counts on hover: who the views came from. */
  parts?: { icon: "person" | "anonymous" | "agent"; n: number; tip: string }[]
  /** Who, drawn in place of the value. */
  who?: DocHeaderWho
  /** The id of the folder the doc is in: the value opens a list of its drops (DocHeaderFolderItem), asked for on hover. */
  folder?: string
}
export type DocHeader = {
  actions: DocHeaderAction[]
  facts: DocHeaderFact[]
  /** Drops related to this one through the pages they link to (server/utils/related.ts), opened in the viewer. */
  related: { id: string; title: string; href: string; icon: string }[]
  /** Those drops' links that this doc doesn't list yet. */
  links: { url: string; label: string; icon: string }[]
}
/** A row of the folder list ("doc-folder-items"); `at` is already words, such as "3 days ago", with `tip` the date. */
type DocHeaderFolderItem = {
  id: string
  title: string
  icon: DocHeaderKindIcon
  at: string
  tip: string
  current: boolean
}
export type DocHeaderFolder = { id: string; title: string; items: DocHeaderFolderItem[] }
export type DocHeaderKindIcon = "doc" | "code" | "image" | "file" | "folder" | "link"

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
  doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8m8 4H8m8 4H8"/>',
  code: '<path d="m16 18l6-6l-6-6M8 6l-6 6l6 6"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  person: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  anonymous:
    '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M14 15a2 2 0 0 0-4 0M2.5 13L5 7c.7-1.3 1.4-2 3-2m13.5 8L19 7c-.7-1.3-1.5-2-3-2"/>',
  agent:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  open: '<path d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
}
const SVGS = Object.fromEntries(Object.entries(ICONS).map(([name, body]) => [name, svg(body)]))
// A row's icon is a mask over the label's color, like the box's own rows (--cfm-icon).
const MASKS = Object.fromEntries(
  (["views", "file", "person", "folder"] as const).map((name) => [
    name,
    `url("data:image/svg+xml,${encodeURIComponent(svg(ICONS[name]).replace("currentColor", "#000"))}")`,
  ]),
)

// The menu and the folder list are popovers in the top layer, placed on their button by CSS anchor positioning: they
// open with the header's motion (140 ms, from .98), and Escape, a click elsewhere, and focus going back are the
// browser's.
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
.drop-btn[data-pending] { cursor: progress; }
.drop-btn[data-pending] [data-icon="copy"] { opacity: .5; }
.drop-btn:focus-visible, .drop-more:focus-visible, .drop-pop button:focus-visible, .drop-folder:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.drop-split > .drop-btn:first-child { border-radius: calc(var(--radius) - 2px) 0 0 calc(var(--radius) - 2px); }
.drop-split > .drop-btn:only-child { border-radius: calc(var(--radius) - 2px); }
.drop-split > .drop-arrow { width: 1.75rem; padding: 0; justify-content: center; border-left: 0; border-radius: 0 calc(var(--radius) - 2px) calc(var(--radius) - 2px) 0; color: var(--muted-foreground); anchor-name: --drop-doc-arrow; }
.drop-split > .drop-arrow:hover { color: var(--foreground); }
.drop-split > .drop-arrow svg { width: .875rem; height: .875rem; }
.drop-note { position: absolute; top: 2.25rem; right: 0; padding: .25rem .5rem; border-radius: calc(var(--radius) - 2px); background: var(--popover); color: var(--destructive, #dc2626); box-shadow: 0 0 0 1px var(--border), 0 4px 16px -4px rgb(0 0 0/.12); font: 500 .75rem/1.25 var(--font-sans); white-space: nowrap; }
.drop-note:empty { display: none; }
.drop-note.drop-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); box-shadow: none; }
.drop-pop { inset: auto; margin: 0; min-width: 13.5rem; padding: .25rem; border: 1px solid var(--border); border-radius: calc(var(--radius) + 2px); background: var(--popover); color: var(--popover-foreground); box-shadow: 0 4px 16px -4px rgb(0 0 0/.12), 0 1px 3px rgb(0 0 0/.06); opacity: 0; transform: translateY(-4px) scale(.98); transition: opacity .14s cubic-bezier(.23,1,.32,1), transform .14s cubic-bezier(.23,1,.32,1), overlay .14s allow-discrete, display .14s allow-discrete; }
.drop-pop:popover-open { opacity: 1; transform: none; }
@starting-style { .drop-pop:popover-open { opacity: 0; transform: translateY(-4px) scale(.98); } }
.drop-menu { position-anchor: --drop-doc-arrow; position-area: bottom span-left; margin-top: .25rem; position-try-fallbacks: flip-block; transform-origin: top right; }
.drop-pop button { display: flex; width: 100%; align-items: center; gap: .5rem; height: 2rem; padding: 0 .5rem; border: 0; border-radius: calc(var(--radius) - 4px); background: none; color: inherit; font: 400 .8125rem/1 var(--font-sans); text-align: left; cursor: pointer; }
.drop-pop button:hover, .drop-pop button:focus-visible { background: var(--accent); outline: none; }
.drop-pop svg { flex: none; width: 1rem; height: 1rem; color: var(--muted-foreground); }
.drop-pop kbd { margin-left: auto; padding: 0 .3rem; border: 1px solid var(--border); border-radius: .25rem; color: var(--muted-foreground); font: 400 .6875rem/1.125rem var(--font-sans); }
drop-folder-menu { position-anchor: --drop-folder; position-area: bottom span-right; margin-top: .25rem; position-try-fallbacks: flip-block, flip-inline; transform-origin: top left; width: min(22rem, calc(100vw - 2rem)); }
drop-folder-menu button > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
drop-folder-menu button > time { flex: none; color: var(--muted-foreground); font-size: .75rem; font-variant-numeric: tabular-nums; }
drop-folder-menu button[aria-current] > span { font-weight: 600; }
drop-folder-menu hr { margin: .25rem -.25rem; border: 0; border-top: 1px solid var(--border); }
drop-folder-menu p { margin: 0; padding: .5rem; color: var(--muted-foreground); font: 400 .8125rem/1.25 var(--font-sans); }
.drop-folder { display: inline-flex; align-items: center; gap: .25rem; max-width: 100%; margin: 0 -.375rem; padding: 0 .375rem; line-height: inherit; border: 0; border-radius: calc(var(--radius) - 4px); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; anchor-name: --drop-folder; }
.drop-folder:hover, .drop-folder[aria-expanded="true"] { background: var(--accent); }
.drop-folder svg { flex: none; width: .875rem; height: .875rem; color: var(--muted-foreground); }
.drop-who { display: inline-flex; align-items: center; gap: .375rem; max-width: 100%; vertical-align: top; }
.drop-who img { display: block; flex: none; width: 1rem; height: 1rem; margin: 0; border-radius: 50%; object-fit: cover; }
.drop-who .drop-logo { border-radius: .25rem; }
.drop-who .drop-initial { display: inline-grid; flex: none; place-items: center; width: 1rem; height: 1rem; border-radius: 50%; background: var(--muted); color: var(--muted-foreground); font: 600 .5625rem/1 var(--font-sans); }
.drop-who .drop-dot { color: var(--muted-foreground); }
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
.drop-fact-part { display: inline-flex; align-items: center; gap: .25rem; color: var(--muted-foreground); font-variant-numeric: tabular-nums; cursor: default; }
.drop-fact-part:first-of-type { margin-left: .375rem; }
.drop-fact-part + .drop-fact-part { margin-left: .5rem; }
.drop-fact-part svg { width: .875rem; height: .875rem; }
@container cfm (max-width: 22rem) {
  drop-doc-facts > div > div { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .drop-head.drop-acts > div:first-of-type > dd { padding-right: 0; }
}
@media (prefers-reduced-motion: reduce) { drop-doc-facts, .drop-more svg, .drop-pop { transition: none; } }
@media print { drop-doc-actions, drop-doc-more, drop-doc-facts, .drop-pop { display: none !important; } .drop-head.drop-acts > div:first-of-type > dd { padding-right: 0; } }
${ICON_SWAP_CSS.replace(/\/\*[\s\S]*?\*\//g, "")}
`

/** How long Copy shows its check, as Drop's other copy buttons (COPY_MS in app/composables/usePreferences.ts). */
const COPIED_MS = 1400

/** Runs in a Markdown doc's frame (planDocument in ./documents). */
export const DOC_HEADER_SCRIPT = String.raw`(() => {
  const box = document.querySelector("article > dl.cfm");
  if (!box) return;
  const SVGS = ${JSON.stringify(SVGS)}, MASKS = ${JSON.stringify(MASKS)}, COPIED_MS = ${COPIED_MS};
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(CSS)};
  document.head.appendChild(style);
  box.classList.add("drop-head");
  const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
  const el = (tag, props, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  const icon = (name) => { const span = document.createElement("span"); span.innerHTML = SVGS[name]; return span.firstChild; };

  // A chip as comark-chips draws one (chipNode): the site's icon, then the words.
  function chip(href, text, src) {
    const a = el("a", { className: "cp", href }, el("img", { className: "cp-img", src, alt: "" }), text);
    a.dataset.kind = "favicon";
    a.dataset.dropAdded = "";
    return a;
  }

  const rows = () => Array.from(box.children).filter((child) => child.localName === "div");
  const actions = el("drop-doc-actions", { hidden: true });
  const more = el("drop-doc-more", { hidden: true });
  const facts = el("drop-doc-facts", { hidden: true, id: "drop-doc-facts" });
  // Custom elements, not divs: comment anchors count the box's divs. The list sits outside the facts, which clip.
  const folderMenu = el("drop-folder-menu", { className: "drop-pop", id: "drop-folder-menu" });
  folderMenu.popover = "auto";
  box.append(actions, more, facts, folderMenu);

  // Up and Down move through a popover's buttons, Home and End to its ends.
  function arrowKeys(pop) {
    pop.addEventListener("keydown", (e) => {
      const items = Array.from(pop.querySelectorAll("button"));
      const at = items.indexOf(document.activeElement);
      const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? -1 : null;
      if (to === null || !items.length) return;
      e.preventDefault();
      items[(to + items.length) % items.length].focus();
    });
  }
  arrowKeys(folderMenu);

  // Copy: its Markdown, which the viewer sends once it's asked (doc-intent), so a click writes it at once.
  let markdown = null, asked = false, waiting = [], copiedTimer = 0, noteTimer = 0;
  const intent = () => { if (!asked) { asked = true; post({ type: "doc-intent" }); } };
  const markdownText = () => markdown !== null ? Promise.resolve(markdown) : new Promise((resolve, reject) => { waiting.push({ resolve, reject }); intent(); });
  function gotMarkdown(text) {
    const list = waiting;
    waiting = [];
    if (typeof text === "string") { markdown = text; for (const w of list) w.resolve(text); }
    else { asked = false; for (const w of list) w.reject(new Error("The Markdown didn't load")); }
  }
  const note = el("span", { className: "drop-note drop-sr" });
  note.setAttribute("role", "status");
  function say(text, failed) {
    clearTimeout(noteTimer);
    note.classList.toggle("drop-sr", !failed);
    note.textContent = text;
    noteTimer = setTimeout(() => { note.textContent = ""; }, failed ? 3000 : COPIED_MS);
  }
  let copyButton = null;
  function showCopied() {
    if (!copyButton) return;
    clearTimeout(copiedTimer);
    copyButton.setAttribute("data-copied", "");
    copiedTimer = setTimeout(() => copyButton && copyButton.removeAttribute("data-copied"), COPIED_MS);
  }
  async function copy() {
    if (!navigator.clipboard) return post({ type: "doc-action", action: "markdown" });
    const button = copyButton;
    if (button) { button.setAttribute("data-pending", ""); button.setAttribute("aria-busy", "true"); }
    try {
      if (markdown !== null) await navigator.clipboard.writeText(markdown);
      else if (typeof ClipboardItem === "function" && navigator.clipboard.write)
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": markdownText().then((text) => new Blob([text], { type: "text/plain" })) })]);
      else await navigator.clipboard.writeText(await markdownText());
      showCopied();
      say("Markdown copied", false);
      post({ type: "doc-copied", ok: true });
    } catch (error) {
      say("Couldn't copy", true);
      post({ type: "doc-copied", ok: false, error: String((error && error.name) || "Error") + ": " + String((error && error.message) || error).slice(0, 200) });
    } finally {
      if (button) { button.removeAttribute("data-pending"); button.removeAttribute("aria-busy"); }
    }
  }

  // The buttons are built again only when the actions change, so a press is never lost to a rebuild and focus stays.
  const ACTION_ICONS = { markdown: "markdown", download: "download", pdf: "pdf" };
  let shownActions = "";
  function act(id) { if (id === "markdown") copy(); else post({ type: "doc-action", action: id }); }
  function renderActions(list) {
    const key = JSON.stringify(list);
    if (key === shownActions) return;
    shownActions = key;
    actions.replaceChildren();
    copyButton = null;
    actions.hidden = !list.length;
    box.classList.toggle("drop-acts", list.length > 0);
    if (!list.length) return;
    const first = list[0];
    const copies = first.id === "markdown";
    const main = el("button", { type: "button", className: "drop-btn", title: first.label + (first.kbd ? " (" + first.kbd + ")" : "") },
      copies ? el("span", {}, el("span", {}, icon("copy")), el("span", {}, icon("check"))) : icon(ACTION_ICONS[first.id]),
      el("span", {}, copies ? "Copy" : first.id === "download" ? "Download" : "PDF"));
    main.setAttribute("aria-label", first.label);
    if (copies) {
      copyButton = main;
      main.dataset.slot = "copy-button";
      const swap = main.firstChild;
      swap.dataset.slot = "copy-button-icon";
      swap.setAttribute("aria-hidden", "true");
      swap.firstChild.dataset.icon = "copy";
      swap.lastChild.dataset.icon = "check";
      main.addEventListener("pointerenter", intent);
      main.addEventListener("focus", intent);
    }
    main.addEventListener("click", () => act(first.id));
    const split = el("div", { className: "drop-split" }, main);
    actions.append(split, note);
    if (list.length < 2) return;
    const menu = el("div", { className: "drop-pop drop-menu", id: "drop-doc-menu" });
    menu.popover = "auto";
    menu.setAttribute("role", "menu");
    const arrow = el("button", { type: "button", className: "drop-btn drop-arrow" }, icon("chevron"));
    arrow.setAttribute("aria-label", "More ways to save this doc");
    arrow.setAttribute("aria-haspopup", "menu");
    arrow.setAttribute("aria-expanded", "false");
    arrow.popoverTargetElement = menu;
    for (const action of list) {
      const item = el("button", { type: "button" }, icon(ACTION_ICONS[action.id]), action.label);
      item.setAttribute("role", "menuitem");
      if (action.kbd) item.append(el("kbd", {}, action.kbd));
      if (action.id === "markdown") { item.addEventListener("pointerenter", intent); item.addEventListener("focus", intent); }
      item.addEventListener("click", () => { menu.hidePopover(); arrow.focus(); act(action.id); });
      menu.append(item);
    }
    menu.addEventListener("toggle", (e) => {
      arrow.setAttribute("aria-expanded", String(e.newState === "open"));
      if (e.newState === "open") menu.querySelector("button").focus({ preventScroll: true });
    });
    arrowKeys(menu);
    split.append(arrow);
    actions.append(menu);
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

  // The folder's drops, asked for when the pointer or focus reaches the folder, and again after they've changed.
  // The list belongs to one folder: when the doc moves, what was loaded for the old one is dropped, and a late answer
  // for it is ignored.
  let folderAsked = false, folderTrigger = null, folderData = null, folderId = null;
  const askFolder = () => { if (!folderAsked) { folderAsked = true; post({ type: "doc-folder" }); } };
  function renderFolder() {
    const data = folderData;
    folderMenu.replaceChildren();
    if (!data) return folderMenu.append(el("p", {}, "Loading\u2026"));
    if (!data.items.length) folderMenu.append(el("p", {}, "Nothing else is in this folder."));
    for (const item of data.items) {
      const time = el("time", { title: item.tip }, item.at);
      const row = el("button", { type: "button" }, icon(SVGS[item.icon] ? item.icon : "file"), el("span", {}, item.title), time);
      if (item.current) row.setAttribute("aria-current", "page");
      row.addEventListener("click", () => { folderMenu.hidePopover(); if (!item.current) post({ type: "doc-open", id: item.id }); });
      folderMenu.append(row);
    }
    folderMenu.append(el("hr"));
    const open = el("button", { type: "button" }, icon("open"), el("span", {}, "Open folder"));
    open.addEventListener("click", () => { folderMenu.hidePopover(); post({ type: "doc-open", id: data.id }); });
    folderMenu.append(open);
  }
  folderMenu.addEventListener("toggle", (e) => {
    if (folderTrigger) folderTrigger.setAttribute("aria-expanded", String(e.newState === "open"));
    if (e.newState !== "open") return;
    askFolder();
    const focus = folderMenu.querySelector("button[aria-current]") || folderMenu.querySelector("button");
    if (focus) focus.focus({ preventScroll: true });
  });

  // Who: an avatar and a name, then the agent's logo and name, with the rest on hover.
  function whoNode(who) {
    const face = who.image
      ? el("img", { src: who.image, alt: "", referrerPolicy: "no-referrer" })
      : el("span", { className: "drop-initial" }, (who.name.trim()[0] || "?").toUpperCase());
    const node = el("span", { className: "drop-who" }, face, el("span", {}, who.name));
    if (who.agent) node.append(el("span", { className: "drop-dot" }, "\u00b7"), el("img", { className: "drop-logo", src: who.agent.logo, alt: "" }), el("span", {}, who.agent.label));
    if (who.tip) node.title = who.tip;
    return node;
  }

  let open = false;
  function renderFacts(list) {
    const wasOpen = open;
    facts.replaceChildren();
    more.replaceChildren();
    folderTrigger = null;
    more.hidden = facts.hidden = !list.length;
    if (!list.length) return;
    const inner = el("div");
    for (const fact of list) {
      const dd = el("dd");
      if (fact.who && typeof fact.who.name === "string") dd.append(whoNode(fact.who));
      else if (typeof fact.folder === "string") {
        if (fact.folder !== folderId) {
          folderId = fact.folder; folderData = null; folderAsked = false; renderFolder();
          if (folderMenu.matches(":popover-open")) askFolder();
        }
        folderTrigger = el("button", { type: "button", className: "drop-folder" }, el("span", {}, fact.value), icon("chevron"));
        folderTrigger.setAttribute("aria-haspopup", "true");
        folderTrigger.setAttribute("aria-expanded", "false");
        folderTrigger.popoverTargetElement = folderMenu;
        folderTrigger.addEventListener("pointerenter", askFolder);
        folderTrigger.addEventListener("focus", askFolder);
        dd.append(folderTrigger);
      } else dd.append(fact.value);
      if (fact.detail) dd.append(el("span", { className: "drop-fact-detail" }, "\u00b7 " + fact.detail));
      for (const part of Array.isArray(fact.parts) ? fact.parts : []) {
        if (!SVGS[part.icon]) continue;
        const pair = el("span", { className: "drop-fact-part", title: part.tip }, icon(part.icon), String(part.n));
        pair.setAttribute("aria-label", part.tip);
        dd.append(pair);
      }
      // The space after the icon, as the box's own labels get from comark's markup.
      const row = el("div", {}, el("dt", {}, " " + fact.label), dd);
      if (MASKS[fact.icon]) row.style.setProperty("--cfm-icon", MASKS[fact.icon]);
      inner.append(row);
    }
    facts.append(inner);
    if (!folderTrigger && folderMenu.matches(":popover-open")) folderMenu.hidePopover();
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
  function renderRelated(related, links) {
    box.querySelectorAll("[data-drop-added]").forEach((node) => node.remove());
    if (!related.length && !links.length) return;
    const has = new Set(Array.from(box.querySelectorAll("a[href]"), (a) => a.href));
    const tags = [];
    for (const drop of related) {
      const a = chip(drop.href, drop.title, drop.icon);
      a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        post({ type: "doc-open", id: drop.id });
      });
      tags.push(a);
    }
    for (const link of links) if (!has.has(new URL(link.url).href)) tags.push(chip(link.url, link.label, link.icon));
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
    dd.append(...tags);
    place();
  }

  let shownRelated = "", shownFacts = "";
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent) return;
    if (m.type === "doc-markdown") return gotMarkdown(m.text);
    // A copy the viewer made, by its shortcut or its menu.
    if (m.type === "doc-copied") return showCopied();
    if (m.type === "doc-folder-items") {
      if (m.folder && m.folder.id !== folderId) return;
      folderData = m.folder && Array.isArray(m.folder.items) ? m.folder : null;
      if (!folderData) folderAsked = false;
      return renderFolder();
    }
    if (m.type !== "doc-header") return;
    renderActions(Array.isArray(m.actions) ? m.actions.filter((a) => ACTION_ICONS[a.id]) : []);
    const related = JSON.stringify([m.related, m.links]);
    if (related !== shownRelated) {
      shownRelated = related;
      renderRelated(Array.isArray(m.related) ? m.related : [], Array.isArray(m.links) ? m.links : []);
    }
    const factsKey = JSON.stringify(m.facts);
    if (factsKey !== shownFacts) {
      shownFacts = factsKey;
      renderFacts(Array.isArray(m.facts) ? m.facts : []);
    }
  });
  renderFolder();
})()`
