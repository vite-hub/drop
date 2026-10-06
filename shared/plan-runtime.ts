// What Drop injects into every plan document.
// The theme contract matches T3 Code's HTML renders (same shadcn token names, --chart-1…6, base stylesheet),
// so a page an agent built for T3 renders the same way in Drop.

const LIGHT = `
  --background: #ffffff; --foreground: #111111; --card: #ffffff; --card-foreground: #111111; --popover: #ffffff; --popover-foreground: #111111;
  --muted: #f5f5f5; --muted-foreground: #666666; --secondary: #fafafa; --secondary-foreground: #111111;
  --border: #eaeaea; --input: #d4d4d4; --ring: #888888; --primary: #0a0a0a; --primary-foreground: #ffffff;
  --accent: #f5f5f5; --accent-foreground: #111111; --accent-surface: #f5f5f5; --accent-surface-foreground: #111111;
  --destructive: #b4261a; --destructive-foreground: #ffffff; --destructive-surface: #fdf0ef;
  --warning: #92400e; --warning-foreground: #ffffff; --warning-surface: #fff7ed;
  --success: #10b981; --success-foreground: #ffffff; --info: #3b82f6; --info-foreground: #ffffff;
  --code-background: #fafafa; --code-foreground: #111111;
  --chart-1: #64748b; --chart-2: #3b82f6; --chart-3: #b4795a; --chart-4: #14b8a6; --chart-5: #8b5cf6; --chart-6: #c2603d; --chart-7: #6b8e4e; --chart-8: #a3708f;
  --positive: #16a34a; --caution: #d97706; --negative: #dc2626;`;

const DARK = `
  --background: #0a0a0a; --foreground: #ededed; --card: #0f0f0f; --card-foreground: #ededed; --popover: #141414; --popover-foreground: #ededed;
  --muted: #1a1a1a; --muted-foreground: #9a9a9a; --secondary: #141414; --secondary-foreground: #ededed;
  --border: #1f1f1f; --input: #333333; --ring: #777777; --primary: #ffffff; --primary-foreground: #0a0a0a;
  --accent: #1a1a1a; --accent-foreground: #ededed; --accent-surface: #1a1a1a; --accent-surface-foreground: #ededed;
  --destructive: #e0726a; --destructive-foreground: #0a0a0a; --destructive-surface: #2a1513;
  --warning: #fbbf24; --warning-foreground: #0a0a0a; --warning-surface: #2a2009;
  --success: #34d399; --success-foreground: #052e1c; --info: #60a5fa; --info-foreground: #0b1b33;
  --code-background: #141414; --code-foreground: #ededed;
  --chart-1: #94a3b8; --chart-2: #60a5fa; --chart-3: #d4a088; --chart-4: #2dd4bf; --chart-5: #a78bfa; --chart-6: #e0866a; --chart-7: #93b874; --chart-8: #c99bb7;
  --positive: #4ade80; --caution: #fbbf24; --negative: #f87171;`;

const SHARED = `--radius: 0.5rem; --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif; --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;`;

export const THEME_CSS = `@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap");
:root { color-scheme: light; ${SHARED} ${LIGHT} }
:root.dark { color-scheme: dark; ${DARK} }
html { background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
body { margin: 0; }
code, kbd, pre, samp { font-family: var(--font-mono); }`;

/** The rules agents follow when they build an HTML plan. Shown on the Agents page and shipped in the skill. */
export const PLAN_AUTHORING_GUIDE = `Write one self-contained HTML document with inline <style> and <script>. Load libraries from a CDN (Chart.js, Mermaid, D3, KaTeX); they run as-is.
Drop shows the page full screen, so center a readable column (max-width ~760px) with its own padding.
Drop injects its theme as CSS custom properties on :root and follows the reader's light/dark mode: --background, --foreground, --muted, --muted-foreground, --card, --border, --primary, --primary-foreground, --destructive, --code-background, --chart-1 … --chart-8 (use in order), --positive, --caution, --negative, --radius, --font-sans, --font-mono. Use them instead of fixed colors. Grayscale first: color only for chart series and status.
Readers comment by selecting text or clicking images, so prefer real text, lists, and tables over text baked into images.
These are the same tokens T3 Code injects into HTML renders, so a page built for T3 looks the same here.`;

/**
 * Comment layer. Runs inside the sandboxed plan (opaque origin), so it only talks to Drop via postMessage.
 * Select text to comment on it; click an image to zoom and comment on a spot.
 * Commented text is highlighted with the CSS Custom Highlight API, so the author's DOM is never modified.
 */
export const ANNOTATOR_SCRIPT = String.raw`(() => {
  const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
  const host = document.createElement("drop-comments");
  host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<style>' +
    '.m{position:absolute;width:20px;height:20px;margin:-10px 0 0 -2px;border-radius:10px 10px 10px 2px;background:var(--primary);color:var(--primary-foreground);font:500 11px/20px var(--font-mono);text-align:center;cursor:pointer;box-shadow:0 1px 4px rgb(0 0 0/.25),0 0 0 2px var(--background);transition:transform 120ms}' +
    '.m:hover{transform:scale(1.15)}.m.done{background:var(--muted-foreground);opacity:.6}.m.img{margin:-10px 0 0 -10px;border-radius:10px}' +
    '.m.pulse{animation:p 900ms ease-out 2}@keyframes p{50%{transform:scale(1.4)}}' +
    '.cp{position:absolute;display:flex;gap:6px;align-items:center;height:22px;padding:0 7px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--muted-foreground);font:500 11px var(--font-mono);cursor:pointer}' +
    '.cp:hover{color:var(--foreground)}.cp b{font-weight:500;text-transform:uppercase;letter-spacing:.06em;opacity:.7}' +
    '</style><div class="marks"></div>';
  const marks = shadow.querySelector(".marks");
  const pageStyle = document.createElement("style");
  pageStyle.textContent = "::highlight(drop-open){background:color-mix(in oklab,var(--foreground) 13%,transparent);text-decoration:underline;text-decoration-color:color-mix(in oklab,var(--foreground) 45%,transparent);text-underline-offset:3px}::highlight(drop-done){background:color-mix(in oklab,var(--foreground) 6%,transparent)}::highlight(drop-active){background:color-mix(in oklab,var(--foreground) 26%,transparent)}img{cursor:zoom-in}";
  let markers = [], active = null;
  const highlights = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";

  function pathOf(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement && parts.length < 10) {
      let part = el.tagName.toLowerCase();
      if (el.id && /^[a-z][\w-]*$/i.test(el.id)) { parts.unshift("#" + el.id); break; }
      const same = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName) : [];
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function labelOf(el) {
    const text = (el.innerText || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ");
    const name = el.tagName.toLowerCase();
    return text ? name + ' "' + (text.length > 40 ? text.slice(0, 40) + "…" : text) + '"' : name;
  }
  const query = (selector) => { try { return (selector && document.querySelector(selector)) || null; } catch (e) { return null; } };
  const BLOCK = /^(p|li|td|th|h[1-6]|blockquote|pre|figcaption|dd|dt|label|section|article|main|div)$/i;
  function blockOf(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body && !BLOCK.test(el.tagName)) el = el.parentElement;
    return el || document.body;
  }

  function findRange(selector, quote) {
    for (const root of [query(selector), document.body]) {
      if (!root) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = []; let text = "";
      while (walker.nextNode()) { nodes.push([walker.currentNode, text.length]); text += walker.currentNode.data; }
      const at = text.indexOf(quote);
      if (at < 0) continue;
      const range = document.createRange();
      // Start snaps forward into the node that begins at the offset; end snaps back into the node that ends there.
      const locate = (offset, end) => { for (let i = nodes.length - 1; i >= 0; i--) if (end ? nodes[i][1] < offset : nodes[i][1] <= offset) return [nodes[i][0], offset - nodes[i][1]]; return [nodes[0][0], 0]; };
      const [sn, so] = locate(at, false), [en, eo] = locate(at + quote.length, true);
      range.setStart(sn, so); range.setEnd(en, Math.min(eo, en.data.length));
      return range;
    }
    return null;
  }

  function render() {
    marks.innerHTML = "";
    const open = [], done = [], act = [];
    for (const m of markers) {
      let x, y;
      if (m.kind === "image") {
        const img = query(m.selector);
        if (!img) continue;
        const r = img.getBoundingClientRect();
        x = r.left + scrollX + (m.ox / 1000) * r.width; y = r.top + scrollY + (m.oy / 1000) * r.height;
      } else {
        const range = m.quote ? findRange(m.selector, m.quote) : null;
        if (!range) continue;
        (m.id === active ? act : m.resolved ? done : open).push(range);
        const rects = range.getClientRects(), last = rects[rects.length - 1];
        if (!last) continue;
        x = last.right + scrollX + 2; y = last.top + scrollY;
      }
      const dot = document.createElement("div");
      dot.className = "m" + (m.kind === "image" ? " img" : "") + (m.resolved ? " done" : "") + (m.id === active ? " pulse" : "");
      dot.textContent = String(m.n);
      dot.style.left = x + "px"; dot.style.top = y + "px";
      dot.onclick = (e) => { e.stopPropagation(); const r = dot.getBoundingClientRect(); post({ type: "marker", id: m.id, clientX: r.right, clientY: r.top }); };
      marks.appendChild(dot);
    }
    // T3-style code blocks: language + copy. The sandbox has no clipboard access, so Drop copies.
    document.querySelectorAll("pre:not(.mermaid)").forEach((pre) => {
      const r = pre.getBoundingClientRect();
      if (r.height < 24) return;
      const chip = document.createElement("button");
      chip.className = "cp";
      chip.innerHTML = (pre.dataset.lang && pre.dataset.lang !== "text" ? "<b></b>" : "") + "<span>Copy</span>";
      if (chip.querySelector("b")) chip.querySelector("b").textContent = pre.dataset.lang;
      marks.appendChild(chip);
      chip.style.left = r.right + scrollX - chip.offsetWidth - 8 + "px";
      chip.style.top = r.top + scrollY + 8 + "px";
      chip.onclick = (e) => {
        e.stopPropagation();
        post({ type: "copy", text: pre.innerText });
        chip.querySelector("span").textContent = "Copied";
        setTimeout(() => { chip.querySelector("span").textContent = "Copy"; }, 1400);
      };
    });
    if (highlights) {
      CSS.highlights.set("drop-open", new Highlight(...open));
      CSS.highlights.set("drop-done", new Highlight(...done));
      CSS.highlights.set("drop-active", new Highlight(...act));
    }
  }

  let lastQuote = "";
  function reportSelection() {
    const sel = getSelection();
    const text = sel && sel.rangeCount ? sel.toString().trim().replace(/\s+/g, " ") : "";
    if (!text || host.contains(sel.anchorNode)) { if (lastQuote) post({ type: "selection", clear: true }); lastQuote = ""; return; }
    const range = sel.getRangeAt(0), r = range.getBoundingClientRect(), block = blockOf(range.commonAncestorContainer);
    lastQuote = text.slice(0, 500);
    post({ type: "selection", quote: lastQuote, selector: pathOf(block), label: labelOf(block), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  }
  let selectionTimer = 0;
  document.addEventListener("mouseup", () => setTimeout(reportSelection, 0));
  document.addEventListener("selectionchange", () => { clearTimeout(selectionTimer); selectionTimer = setTimeout(reportSelection, 250); });
  document.addEventListener("keyup", (e) => { if (e.shiftKey || e.key === "Shift") reportSelection(); });
  document.addEventListener("scroll", () => { if (lastQuote) reportSelection(); }, { passive: true });

  document.addEventListener("click", (e) => {
    const img = e.target && e.target.closest ? e.target.closest("img") : null;
    if (!img || host.contains(img) || (getSelection() && !getSelection().isCollapsed)) return;
    e.preventDefault(); e.stopPropagation();
    post({ type: "image", src: img.currentSrc || img.src, alt: img.alt || "", selector: pathOf(img), label: labelOf(img) });
  }, true);

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__drop || e.source !== parent) return;
    if (m.type === "markers") { markers = m.markers; render(); }
    if (m.type === "clear-selection") { getSelection().removeAllRanges(); lastQuote = ""; }
    if (m.type === "focus") {
      active = m.id; render();
      const dot = Array.from(marks.children).find((d) => d.classList.contains("pulse"));
      if (dot) scrollTo({ top: Math.max(0, parseFloat(dot.style.top) - innerHeight / 3), behavior: "smooth" });
      setTimeout(() => { active = null; render(); }, 2200);
    }
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") post({ type: "key", key: "Escape" }); });
  window.addEventListener("resize", render);
  new ResizeObserver(render).observe(document.documentElement);
  document.documentElement.appendChild(host);
  document.head.appendChild(pageStyle);
  post({ type: "ready" });
})();`;

const TIPTAP = "https://esm.sh/@tiptap";
const TIPTAP_VERSION = "3.31.4"; // Same version as the Quiver wiki editor.

export const EDITOR_CSS = `
#editor .ProseMirror { outline: none; min-height: 60vh; }
#editor .ProseMirror > * + * { margin-top: var(--typeset-flow, 1.25em); }
#editor .ProseMirror .is-empty::before { content: attr(data-placeholder); color: var(--muted-foreground); float: left; height: 0; pointer-events: none; }
#editor ul[data-type="taskList"] { list-style: none; padding-left: 0; }
#editor ul[data-type="taskList"] li { display: flex; gap: .55rem; align-items: flex-start; }
#editor ul[data-type="taskList"] li > label { margin-top: .25em; }
#editor ul[data-type="taskList"] li > div { flex: 1; min-width: 0; }
#editor ul[data-type="taskList"] li > div > p, #editor li > p { margin: 0; }
#editor ul[data-type="taskList"] li > label input { margin: 0; }
#editor-loading { color: var(--muted-foreground); font: 12px var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }
`;

/**
 * Notion-style editor for Markdown plans: TipTap from esm.sh, a floating format toolbar on selection,
 * and a "/" command menu. Talks to Drop via postMessage; Drop saves the result as the next version.
 */
export const EDITOR_SCRIPT = String.raw`
const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
const raw = JSON.parse(document.getElementById("drop-source").textContent);
// Front matter (title, supersedes) is metadata, not content: keep it out of the editor and put it back on save.
const frontmatter = (raw.match(/^---\n[\s\S]*?\n---\n?/) || [""])[0];
const source = raw.slice(frontmatter.length).replace(/^\n+/, "");
const withFrontmatter = (markdown) => (frontmatter ? frontmatter.replace(/\n?$/, "\n\n") : "") + markdown;
const v = "@" + "__VERSION__";
try {
  const [{ Editor }, { default: StarterKit }, { Markdown }, { TaskList, TaskItem }, { Placeholder }, { TableKit }] = await Promise.all([
    import("__TIPTAP__/core" + v), import("__TIPTAP__/starter-kit" + v), import("__TIPTAP__/markdown" + v),
    import("__TIPTAP__/extension-list" + v), import("__TIPTAP__/extensions" + v), import("__TIPTAP__/extension-table" + v)
  ]);
  document.getElementById("editor-loading").remove();

  const host = document.createElement("drop-editor-ui");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<style>" +
    ".bar,.menu{position:fixed;z-index:10;display:none;background:var(--card);color:var(--foreground);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgb(0 0 0/.08);font:13px var(--font-sans)}" +
    ".bar{padding:3px;gap:2px;align-items:center}.bar.on{display:flex;animation:in 120ms cubic-bezier(.23,1,.32,1)}" +
    ".bar button{all:unset;cursor:pointer;height:28px;min-width:28px;padding:0 7px;box-sizing:border-box;border-radius:6px;display:grid;place-items:center;font:500 12px var(--font-mono);color:var(--muted-foreground)}" +
    ".bar button:hover{background:var(--muted);color:var(--foreground)}.bar button.active{background:var(--primary);color:var(--primary-foreground)}" +
    ".sep{width:1px;height:18px;background:var(--border);margin:0 3px}" +
    ".menu{width:240px;padding:4px;max-height:320px;overflow:auto}.menu.on{display:block;animation:in 120ms cubic-bezier(.23,1,.32,1)}" +
    ".label{font:11px var(--font-mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted-foreground);padding:6px 8px 4px}" +
    ".item{display:flex;gap:10px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer}.item.sel{background:var(--muted)}" +
    ".item kbd{margin-left:auto;font:11px var(--font-mono);color:var(--muted-foreground)}" +
    ".glyph{width:26px;height:26px;border:1px solid var(--border);border-radius:6px;display:grid;place-items:center;font:500 11px var(--font-mono);color:var(--muted-foreground);background:var(--background)}" +
    ".empty{padding:8px;color:var(--muted-foreground)}" +
    "@keyframes in{from{opacity:0;transform:translateY(4px)}}@media (prefers-reduced-motion:reduce){@keyframes in{from{opacity:0}}}" +
    "</style><div class='bar'></div><div class='menu'></div>";
  const bar = shadow.querySelector(".bar"), menu = shadow.querySelector(".menu");
  document.documentElement.appendChild(host);

  const editor = new Editor({
    element: document.getElementById("editor"),
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown, TaskList, TaskItem.configure({ nested: true }), TableKit.configure({ table: { resizable: false } }), Placeholder.configure({ placeholder: "Write, or type / for blocks" })],
    content: source,
    contentType: "markdown",
    autofocus: source.trim() ? false : "end"
  });

  const MARKS = [
    ["B", "Bold", (c) => c.toggleBold(), "bold"], ["I", "Italic", (c) => c.toggleItalic(), "italic"],
    ["S", "Strike", (c) => c.toggleStrike(), "strike"], ["<>", "Code", (c) => c.toggleCode(), "code"],
    ["Link", "Link", null, "link"], "|",
    ["H1", "Heading 1", (c) => c.toggleHeading({ level: 1 }), "heading", { level: 1 }], ["H2", "Heading 2", (c) => c.toggleHeading({ level: 2 }), "heading", { level: 2 }],
    ["H3", "Heading 3", (c) => c.toggleHeading({ level: 3 }), "heading", { level: 3 }], "|",
    ["List", "Bulleted list", (c) => c.toggleBulletList(), "bulletList"], ["1.", "Numbered list", (c) => c.toggleOrderedList(), "orderedList"],
    ["Todo", "To-do list", (c) => c.toggleTaskList(), "taskList"], ["Quote", "Quote", (c) => c.toggleBlockquote(), "blockquote"]
  ];
  function renderBar() {
    const { from, to, empty } = editor.state.selection;
    if (empty || !editor.isFocused || slash) { bar.classList.remove("on"); return; }
    bar.innerHTML = "";
    for (const entry of MARKS) {
      if (entry === "|") { const s = document.createElement("span"); s.className = "sep"; bar.appendChild(s); continue; }
      const [text, title, run, name, attrs] = entry;
      const b = document.createElement("button");
      b.textContent = text; b.title = title;
      if (editor.isActive(name, attrs)) b.classList.add("active");
      b.onmousedown = (e) => {
        e.preventDefault();
        if (name === "link") {
          const previous = editor.getAttributes("link").href || "";
          const href = prompt("Link URL", previous);
          if (href === null) return;
          href ? editor.chain().focus().extendMarkRange("link").setLink({ href }).run() : editor.chain().focus().unsetLink().run();
        } else run(editor.chain().focus()).run();
        renderBar();
      };
      bar.appendChild(b);
    }
    bar.classList.add("on");
    const a = editor.view.coordsAtPos(from), z = editor.view.coordsAtPos(to);
    const width = bar.offsetWidth;
    bar.style.left = Math.max(8, Math.min(innerWidth - width - 8, (a.left + z.right) / 2 - width / 2)) + "px";
    bar.style.top = Math.max(8, a.top - 44) + "px";
  }

  const BLOCKS = [
    ["Aa", "Text", "paragraph", (c) => c.setParagraph()], ["H1", "Heading 1", "h1 title", (c) => c.setHeading({ level: 1 })],
    ["H2", "Heading 2", "h2 subtitle", (c) => c.setHeading({ level: 2 })], ["H3", "Heading 3", "h3", (c) => c.setHeading({ level: 3 })],
    ["•", "Bulleted list", "ul bullet list", (c) => c.toggleBulletList()], ["1.", "Numbered list", "ol numbered list", (c) => c.toggleOrderedList()],
    ["[ ]", "To-do list", "todo task check", (c) => c.toggleTaskList()], ["“", "Quote", "quote blockquote", (c) => c.toggleBlockquote()],
    ["{}", "Code block", "code pre", (c) => c.toggleCodeBlock()], ["—", "Divider", "hr divider rule", (c) => c.setHorizontalRule()]
  ];
  let slash = null, picked = 0;
  function slashState() {
    const { $from, empty } = editor.state.selection;
    if (!empty || $from.parent.type.name === "codeBlock") return null;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const match = before.match(/(?:^|\s)\/([\w ]{0,20})$/);
    if (!match) return null;
    return { query: match[1].toLowerCase(), from: $from.pos - match[1].length - 1, to: $from.pos };
  }
  function matches() { return slash ? BLOCKS.filter(([, title, words]) => (title + " " + words).toLowerCase().includes(slash.query.trim())) : []; }
  function renderMenu() {
    slash = slashState();
    const list = matches();
    if (!slash) { menu.classList.remove("on"); return; }
    picked = Math.min(picked, Math.max(0, list.length - 1));
    menu.innerHTML = "<div class='label'>Blocks</div>" + (list.length ? "" : "<div class='empty'>No blocks match</div>");
    list.forEach(([glyph, title], index) => {
      const row = document.createElement("div");
      row.className = "item" + (index === picked ? " sel" : "");
      row.innerHTML = "<span class='glyph'></span><span></span>";
      row.children[0].textContent = glyph; row.children[1].textContent = title;
      row.onmousedown = (e) => { e.preventDefault(); apply(index); };
      menu.appendChild(row);
    });
    menu.classList.add("on");
    const c = editor.view.coordsAtPos(slash.from);
    menu.style.left = Math.min(innerWidth - 248, c.left) + "px";
    const below = c.bottom + 6, height = Math.min(320, menu.offsetHeight);
    menu.style.top = (below + height > innerHeight - 8 ? c.top - height - 6 : below) + "px";
    bar.classList.remove("on");
  }
  function apply(index) {
    const item = matches()[index];
    if (!item || !slash) return;
    item[3](editor.chain().focus().deleteRange({ from: slash.from, to: slash.to })).run();
    slash = null; picked = 0;
    menu.classList.remove("on");
  }
  editor.view.dom.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); post({ type: "edit-save" }); return; }
    if (!slash) { if (e.key === "Escape") post({ type: "key", key: "Escape" }); return; }
    const count = matches().length;
    if (e.key === "ArrowDown") { e.preventDefault(); picked = (picked + 1) % Math.max(1, count); renderMenu(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); picked = (picked - 1 + count) % Math.max(1, count); renderMenu(); }
    else if (e.key === "Enter" && count) { e.preventDefault(); e.stopPropagation(); apply(picked); }
    else if (e.key === "Escape") { e.preventDefault(); slash = null; menu.classList.remove("on"); }
  }, true);

  let timer = 0;
  editor.on("update", () => {
    picked = 0;
    renderMenu();
    clearTimeout(timer);
    timer = setTimeout(() => post({ type: "edit-change", markdown: withFrontmatter(editor.getMarkdown()) }), 250);
  });
  editor.on("selectionUpdate", () => { renderMenu(); renderBar(); });
  editor.on("blur", () => setTimeout(() => { bar.classList.remove("on"); menu.classList.remove("on"); }, 120));
  addEventListener("scroll", () => { renderBar(); if (slash) renderMenu(); }, { passive: true });
  post({ type: "edit-ready" });
} catch (error) {
  post({ type: "edit-error", message: String(error) });
}`.replaceAll("__TIPTAP__", TIPTAP).replaceAll("__VERSION__", TIPTAP_VERSION);

/** Inject theme + annotator into a full HTML document without touching the author's markup. */
export function injectRuntime(html: string, dark: boolean): string {
  const head = `<style data-drop-theme>${THEME_CSS}</style><script>document.documentElement.classList.toggle("dark", ${dark});</script>`;
  const tail = `<script>${ANNOTATOR_SCRIPT}</script>`;
  let out = /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (match) => match + head) : head + html;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, tail + "</body>") : out + tail;
  return out;
}
