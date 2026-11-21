// Draws a lesson: the guide column, the files, the editor and the preview. It runs after assets/lesson.js, as one
// module script, and reads lesson.md from the page's #lesson slot.

const LANG_NAMES = {
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  md: "Markdown",
  py: "Python",
  vue: "Vue",
  svg: "SVG",
  sh: "Shell",
  yaml: "YAML",
  text: "Plain text",
};

const ICON = {
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  list: '<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  reload:
    '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  wrap: '<path d="M3 6h18M3 12h15a3 3 0 1 1 0 6h-4"/><path d="m16 16-2 2 2 2"/><path d="M3 18h7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
};
const icon = (name, size = 16) =>
  `<svg class="ca-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "html") el.innerHTML = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child);
  return el;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const extOf = (path) => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "text";
const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, fail) => setTimeout(() => fail(new Error("timed out")), ms))]);

// ---------- loading

async function loadEditorKit() {
  // page.html's import map says where each package comes from.
  const [cm, state, view, language, commands, highlight, ...langs] = await Promise.all([
    import("codemirror"),
    import("@codemirror/state"),
    import("@codemirror/view"),
    import("@codemirror/language"),
    import("@codemirror/commands"),
    import("@lezer/highlight"),
    import("@codemirror/lang-javascript"),
    import("@codemirror/lang-html"),
    import("@codemirror/lang-css"),
    import("@codemirror/lang-json"),
    import("@codemirror/lang-markdown"),
    import("@codemirror/lang-python"),
  ]);
  const [javascript, html, css, json, markdown, python] = langs;
  const languageFor = (ext) =>
    ({
      js: () => javascript.javascript(),
      mjs: () => javascript.javascript(),
      jsx: () => javascript.javascript({ jsx: true }),
      ts: () => javascript.javascript({ typescript: true }),
      tsx: () => javascript.javascript({ jsx: true, typescript: true }),
      html: () => html.html(),
      vue: () => html.html(),
      svg: () => html.html(),
      css: () => css.css(),
      json: () => json.json(),
      md: () => markdown.markdown(),
      py: () => python.python(),
    })[ext]?.() ?? [];
  return { ...language, ...commands, ...cm, ...state, ...view, highlight, language: languageFor };
}

function resolvePath(from, ref) {
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
  const clean = ref.split("#")[0].split("?")[0];
  if (!clean) return null;
  const parts = clean.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of clean.replace(/^\//, "").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

function scriptJSON(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function previewRuntime(files, run, entries) {
  return `(() => {
  const files = Object.assign(Object.create(null), JSON.parse(${scriptJSON(JSON.stringify(files))}));
  const resolvePath = ${resolvePath.toString()};
  const post = (message) => parent.postMessage(Object.assign({ __codeAlong: true, run: ${run} }, message), "*");
  const show = (value) => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack && value.stack.includes(value.message) ? value.stack : value.name + ": " + value.message;
    try { const text = JSON.stringify(value, (key, val) => typeof val === "bigint" ? val + "n" : val); return text === undefined ? String(value) : text; } catch { return String(value); }
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => { post({ type: "log", level, text: args.map(show).join(" ") }); original(...args); };
  }
  const logError = (text) => post({ type: "log", level: "error", text });
  addEventListener("error", (event) => logError(event.error ? show(event.error) : event.message));
  addEventListener("unhandledrejection", (event) => logError("Uncaught (in promise) " + show(event.reason)));
  addEventListener("load", async () => {
    try {
      await Promise.all(${scriptJSON(entries)}.map((specifier) => import(specifier)));
      post({ type: "ready" });
    } catch (error) {
      logError(show(error));
      post({ type: "failed" });
    }
  });
  const types = { css: "text/css", js: "text/javascript", json: "application/json", svg: "image/svg+xml", md: "text/markdown", html: "text/html" };
  const native = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = resolvePath("index.html", url);
    if (path !== null && path in files)
      return Promise.resolve(new Response(files[path], { status: 200, headers: { "content-type": types[path.split(".").pop()] || "text/plain" } }));
    return native(input, init);
  };
})();`;
}

const moduleLexer = () => withTimeout(import("es-module-lexer/js"), 10000);
let lexerPromise;
const dataURL = (type, source) => `data:${type};charset=utf-8,${encodeURIComponent(source.toWellFormed())}`;

function previewModules(files, parse, importMaps) {
  const imports = Object.create(null);
  const modules = new Map();
  const add = (path, inlineSource) => {
    if (modules.has(path)) return modules.get(path);
    const name = `@code-along/virtual/${modules.size}`;
    modules.set(path, name);
    let source = inlineSource ?? files[path];
    let type = "text/javascript";
    if (path.endsWith(".json")) type = "application/json";
    else if (path.endsWith(".css")) {
      source = `document.head.append(Object.assign(document.createElement("style"), { textContent: ${JSON.stringify(source)} }));`;
    } else {
      let references;
      try { [references] = parse(source, path); }
      catch (error) { throw new Error(`${path}: ${error.message}`); }
      for (const { n: specifier, d: dynamic, s: start, e: end, a: attributes } of references.toReversed()) {
        if (dynamic === -2) continue;
        if (specifier === undefined) throw new Error(`${path}: use a string literal in dynamic import().`);
        let target = specifier;
        if (/^(?:\.{1,2}\/|\/(?!\/))/.test(specifier)) {
          const resolved = resolvePath(path.includes("#") ? "index.html" : path, specifier);
          if (!Object.hasOwn(files, resolved)) throw new Error(`${path} imports ${specifier}, which isn't a file of this step.`);
          if (!/\.(?:m?js|json|css)$/i.test(resolved)) throw new Error(`${path}: fetch ${specifier} instead of importing it.`);
          if (resolved.endsWith(".json") && attributes === -1) {
            target = add(`${resolved}#default`, `export default JSON.parse(${JSON.stringify(files[resolved])});`);
          } else target = add(resolved);
        } else if (specifier.startsWith("//")) target = `https:${specifier}`;
        else if (!/^[a-z][a-z0-9+.-]*:/i.test(specifier) && !importMaps) target = `https://esm.sh/${specifier}`;
        const from = dynamic < 0 ? start - 1 : start;
        const to = dynamic < 0 ? end + 1 : end;
        source = source.slice(0, from) + JSON.stringify(target) + source.slice(to);
      }
    }
    imports[name] = dataURL(type, type === "text/javascript" ? `${source}\n//# sourceURL=code-along/${encodeURI(path)}` : source);
    return name;
  };
  return { add, imports };
}

async function previewDocument(files, run) {
  const doc = new DOMParser().parseFromString(files["index.html"], "text/html");
  const script = (type, source) => Object.assign(doc.createElement("script"), { type, textContent: source });
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const target = resolvePath("index.html", link.getAttribute("href"));
    if (Object.hasOwn(files, target)) {
      const style = doc.createElement("style");
      if (link.media) style.media = link.media;
      style.textContent = files[target];
      link.replaceWith(style);
    }
  }
  for (const image of doc.querySelectorAll("img[src], source[src], image[href], use[href]")) {
    const attr = image.hasAttribute("src") ? "src" : "href";
    const target = resolvePath("index.html", image.getAttribute(attr));
    if (target?.endsWith(".svg") && Object.hasOwn(files, target)) image.setAttribute(attr, dataURL("image/svg+xml", files[target]));
  }
  const modules = [...doc.querySelectorAll("script")].filter((tag) => tag.type.toLowerCase() === "module");
  const entries = [];
  const importMaps = [...doc.querySelectorAll('script[type="importmap" i]')];
  if (modules.length) {
    const localEntries = modules.some((tag) => !tag.hasAttribute("src") || resolvePath("index.html", tag.getAttribute("src")));
    let parse;
    if (localEntries) {
      try {
        const lexer = await (lexerPromise ??= moduleLexer().catch((error) => { lexerPromise = null; throw error; }));
        parse = lexer.parse;
      } catch { throw new Error("The preview module parser could not load. Connect to the network and try again."); }
    }
    const { add, imports } = previewModules(files, parse, importMaps.length);
    for (const [index, tag] of modules.entries()) {
      const src = tag.getAttribute("src");
      const path = src === null ? `index.html#module-${index + 1}` : resolvePath("index.html", src);
      if (src !== null && path && !Object.hasOwn(files, path)) throw new Error(`index.html loads ${src}, which isn't a file of this step.`);
      const specifier = path ? add(path, src === null ? tag.textContent : undefined) : new URL(src, document.baseURI).href;
      entries.push(specifier);
      tag.removeAttribute("src");
      tag.textContent = `import ${scriptJSON(specifier)};`;
    }
    doc.head.prepend(script("importmap", scriptJSON({ imports })), ...importMaps);
  }
  for (const tag of doc.querySelectorAll("script[src]")) {
    const target = resolvePath("index.html", tag.getAttribute("src"));
    if (Object.hasOwn(files, target)) tag.src = dataURL("text/javascript", `${files[target]}\n//# sourceURL=code-along/${encodeURI(target)}`);
  }
  doc.head.prepend(script("text/javascript", previewRuntime(files, run, entries)));
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

// ---------- the page

function mount(root, lesson, kit, source) {
  const { marked } = kit;
  const cm = kit.editor;
  const storeKey = `code-along:${fnv(source)}`;
  let persistent = self.origin !== "null";
  const storageNotice = h("div", { class: "ca-storage-notice", role: "status" });
  const warnTemporary = () => {
    persistent = false;
    storageNotice.textContent = "Temporary edits: reloading may lose your changes.";
  };
  let edits = {};
  try {
    if (persistent) edits = JSON.parse(localStorage.getItem(storeKey) || "{}") || {};
  } catch {
    persistent = false;
  }
  if (!persistent) warnTemporary();
  const saveEdits = () => {
    if (!persistent) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify(edits));
    } catch {
      warnTemporary();
    }
  };
  const state = { step: 0, file: null, tab: "preview", wrap: false, logs: [] };
  const steps = lesson.steps;
  const step = () => steps[state.step];
  const contentOf = (s, path) => edits[s.id]?.[path] ?? s.files[path].content;
  const isEdited = (s, path) => edits[s.id]?.[path] !== undefined;
  const filesOf = (s) => Object.fromEntries(Object.keys(s.files).map((path) => [path, contentOf(s, path)]));

  // Guide
  const stepMenu = h("div", { class: "ca-menu", id: "ca-steps", popover: "auto", role: "menu" });
  const menuButton = h("button", {
    class: "ca-btn is-ghost is-sm ca-menu-button",
    popovertarget: "ca-steps",
    "aria-label": "Steps",
  });
  stepMenu.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    const box = menuButton.getBoundingClientRect();
    stepMenu.style.top = `${box.bottom + 6}px`;
    stepMenu.style.left = `${Math.max(8, Math.min(box.right - 280, innerWidth - 288))}px`;
  });
  const articles = steps.map((s, index) => {
    const body = h("div", { class: "ca-prose" });
    body.innerHTML = renderMarkdown(s.guide);
    decorate(body, s);
    return h(
      "article",
      { class: "ca-step", id: s.id, "data-step": s.id, hidden: index !== 0 },
      index === 0 && lesson.intro ? h("div", { class: "ca-prose ca-intro", html: renderMarkdown(lesson.intro) }) : null,
      h("p", { class: "ca-eyebrow" }, `Step ${index + 1} of ${steps.length}`),
      h("h1", { class: "ca-step-title" }, s.title),
      body,
    );
  });
  const back = h("button", { class: "ca-btn is-outline", onclick: () => go(state.step - 1), html: `${icon("chevronLeft")}<span>Back</span>` });
  const next = h("button", { class: "ca-btn is-primary", onclick: () => go(state.step + 1), html: `<span>Next</span>${icon("chevronRight")}` });
  const guideBody = h("div", { class: "ca-guide-body" }, articles);
  const guide = h(
    "aside",
    { class: "ca-guide", "aria-label": "Guide" },
    h("header", { class: "ca-guide-head" }, h("span", { class: "ca-lesson-title" }, lesson.title), menuButton, stepMenu),
    guideBody,
    // A one-step lesson (a prototype to try) has nothing to step through.
    lesson.steps.length > 1
      ? h("footer", { class: "ca-guide-foot" }, back, h("span", { class: "ca-dots", "aria-hidden": "true" }), next)
      : null,
  );
  if (lesson.steps.length < 2) menuButton.hidden = true;

  // Output
  const frame = h("iframe", { class: "ca-frame", title: "Preview", sandbox: "allow-scripts" });
  const consoleList = h("ol", { class: "ca-console", "aria-live": "polite" });
  const tabPreview = h("button", { class: "ca-tab", role: "tab", onclick: () => setTab("preview") }, "Preview");
  const consoleCount = h("span", { class: "ca-count", hidden: true });
  const tabConsole = h("button", { class: "ca-tab", role: "tab", onclick: () => setTab("console") }, "Console", consoleCount);
  const output = h(
    "section",
    { class: "ca-output", "aria-label": "Output" },
    h(
      "header",
      { class: "ca-pane-head" },
      h("div", { class: "ca-tabs", role: "tablist" }, tabPreview, tabConsole),
      h("button", {
        class: "ca-btn is-ghost is-icon",
        title: "Run again",
        "aria-label": "Run again",
        onclick: () => runPreview(true),
        html: icon("reload", 15),
      }),
    ),
    h("div", { class: "ca-output-body" }, frame, consoleList),
  );

  // Files and editor
  const tree = h("ul", { class: "ca-tree", role: "tree", "aria-label": "Files" });
  const resetButton = h("button", {
    class: "ca-btn is-outline is-sm ca-reset",
    onclick: resetStep,
    title: "Put this step's files back as the lesson wrote them",
    html: `${icon("reset", 14)}<span>Reset</span>`,
  });
  const files = h(
    "nav",
    { class: "ca-files", "aria-label": "Files" },
    h("header", { class: "ca-pane-head" }, h("span", { class: "ca-pane-label" }, "Files")),
    tree,
    h("footer", { class: "ca-files-foot" }, resetButton),
  );
  const crumbs = h("div", { class: "ca-crumbs" });
  const wrapButton = h("button", {
    class: "ca-btn is-ghost is-icon",
    title: "Wrap lines (Alt+Z)",
    "aria-label": "Wrap lines",
    "aria-pressed": "false",
    onclick: () => setWrap(!state.wrap),
    html: icon("wrap", 15),
  });
  const editorHost = h("div", { class: "ca-editor-host" });
  const statusLeft = h("span", { class: "ca-status-left" });
  const statusRight = h("span", { class: "ca-status-right" });
  const editorPane = h(
    "section",
    { class: "ca-editor", "aria-label": "Editor" },
    h("header", { class: "ca-pane-head" }, crumbs, wrapButton),
    editorHost,
    storageNotice,
    h("footer", { class: "ca-status" }, statusLeft, statusRight),
  );
  const work = h("main", { class: "ca-work" }, output, h("div", { class: "ca-code" }, files, editorPane));
  const shell = h("div", { class: "ca-shell", "data-guide": lesson.guide }, guide, work);
  root.replaceChildren(shell);

  const editor = cm ? codeMirrorEditor(editorHost) : textareaEditor(editorHost);

  // ---------- behavior

  function go(index, fromHash = false) {
    if (index < 0 || index >= steps.length) return;
    state.step = index;
    const s = step();
    articles.forEach((article, i) => (article.hidden = i !== index));
    guideBody.scrollTop = 0;
    back.disabled = index === 0;
    next.disabled = index === steps.length - 1;
    next.title = steps[index + 1] ? `Next: ${steps[index + 1].title}` : "";
    menuButton.innerHTML = `${icon("list", 15)}<span>${index + 1} / ${steps.length}</span>${icon("chevronDown", 14)}`;
    guide.querySelector(".ca-dots")?.replaceChildren(
      ...steps.map((_, i) => h("span", { class: i === index ? "is-on" : i < index ? "is-done" : "" })),
    );
    stepMenu.replaceChildren(
      ...steps.map((item, i) =>
        h(
          "button",
          {
            class: `ca-menu-item${i === index ? " is-current" : ""}`,
            role: "menuitem",
            onclick: () => (stepMenu.hidePopover(), go(i)),
          },
          h("span", { class: "ca-menu-num" }, String(i + 1)),
          h("span", { class: "ca-menu-text" }, item.title),
          i === index ? h("span", { html: icon("check", 14) }) : null,
        ),
      ),
    );
    if (!fromHash)
      try {
        history.replaceState(null, "", `#${encodeURIComponent(s.id)}`);
      } catch {}
    const hasPreview = Boolean(s.files["index.html"]);
    shell.toggleAttribute("data-no-preview", !hasPreview);
    renderTree();
    openFile(s.preferredFile ?? (s.files[state.file] ? state.file : s.active));
    runPreview(true);
  }

  function renderTree() {
    const s = step();
    const rows = [];
    const seen = new Set();
    for (const path of Object.keys(s.files)) {
      const parts = path.split("/");
      for (let depth = 0; depth < parts.length - 1; depth++) {
        const dir = parts.slice(0, depth + 1).join("/");
        if (seen.has(dir)) continue;
        seen.add(dir);
        rows.push(
          h(
            "li",
            { class: "ca-tree-row is-dir", style: `--depth:${depth}`, role: "treeitem", "aria-expanded": "true" },
            h("span", { class: "ca-tree-icon", html: icon("folder", 14) }),
            h("span", { class: "ca-tree-name" }, parts[depth]),
          ),
        );
      }
      const changed = s.changed.includes(path) && state.step > 0;
      const edited = isEdited(s, path);
      rows.push(
        h(
          "li",
          { role: "none" },
          h(
            "button",
            {
              class: `ca-tree-row${path === state.file ? " is-active" : ""}`,
              style: `--depth:${parts.length - 1}`,
              role: "treeitem",
              "aria-selected": String(path === state.file),
              "data-path": path,
              title: path,
              onclick: () => openFile(path),
            },
            h("span", { class: "ca-tree-icon", html: icon("file", 14) }),
            h("span", { class: "ca-tree-name" }, parts.at(-1)),
            edited
              ? h("span", { class: "ca-mark is-edited", title: "You edited this file" }, "M")
              : changed
                ? h("span", { class: "ca-mark is-changed", title: "Changed in this step" })
                : null,
          ),
        ),
      );
    }
    tree.replaceChildren(...rows);
    resetButton.disabled = !Object.keys(edits[s.id] ?? {}).length;
  }

  function openFile(path, lines) {
    const s = step();
    if (!path || !s.files[path]) return;
    state.file = path;
    for (const row of tree.querySelectorAll("button.ca-tree-row")) {
      const on = row.dataset.path === path;
      row.classList.toggle("is-active", on);
      row.setAttribute("aria-selected", String(on));
    }
    const parts = path.split("/");
    crumbs.replaceChildren(
      ...parts.flatMap((part, i) => [
        ...(i ? [h("span", { class: "ca-crumb-sep", html: icon("chevronRight", 12) })] : []),
        h("span", { class: i === parts.length - 1 ? "ca-crumb is-file" : "ca-crumb" }, part),
      ]),
    );
    editor.open(`${s.id}\n${path}`, contentOf(s, path), extOf(path));
    if (lines) editor.select(lines.from, lines.to);
    renderStatus();
  }

  function renderStatus(cursor = editor.cursor()) {
    const s = step();
    const ext = extOf(state.file ?? "");
    statusLeft.textContent = state.file && isEdited(s, state.file) ? "Edited" : "";
    statusRight.textContent = `Ln ${cursor.line}, Col ${cursor.col} · ${LANG_NAMES[ext] ?? ext.toUpperCase()}`;
  }

  function onEdit(text) {
    const s = step();
    const path = state.file;
    if (!path) return;
    const bucket = (edits[s.id] ??= {});
    if (text === s.files[path].content) delete bucket[path];
    else bucket[path] = text;
    if (!Object.keys(bucket).length) delete edits[s.id];
    saveEdits();
    const row = tree.querySelector(`button.ca-tree-row[data-path="${CSS.escape(path)}"]`);
    if (row) {
      row.querySelector(".ca-mark")?.remove();
      if (isEdited(s, path)) row.append(h("span", { class: "ca-mark is-edited", title: "You edited this file" }, "M"));
      else if (s.changed.includes(path) && state.step > 0)
        row.append(h("span", { class: "ca-mark is-changed", title: "Changed in this step" }));
    }
    resetButton.disabled = !edits[s.id];
    renderStatus();
    runPreview();
  }

  function resetStep() {
    const s = step();
    delete edits[s.id];
    saveEdits();
    editor.forget(`${s.id}\n`);
    renderTree();
    openFile(state.file);
    runPreview(true);
  }

  let timer = 0;
  let previewRun = 0;
  function runPreview(now = false) {
    clearTimeout(timer);
    const id = ++previewRun;
    const s = step();
    state.logs = [];
    renderConsole();
    shell.dataset.preview = s.files["index.html"] ? "running" : "none";
    if (!s.files["index.html"]) {
      frame.removeAttribute("srcdoc");
      return;
    }
    const run = async () => {
      try {
        const html = await previewDocument(filesOf(s), id);
        if (id === previewRun) frame.srcdoc = html;
      } catch (error) {
        if (id !== previewRun) return;
        frame.removeAttribute("srcdoc");
        state.logs.push({ level: "error", text: error.message });
        renderConsole();
        shell.dataset.preview = "failed";
      }
    };
    if (now) run();
    else timer = setTimeout(run, 350);
  }

  addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.data?.__codeAlong !== true || event.data.run !== previewRun) return;
    if (event.data.type === "failed") shell.dataset.preview = "failed";
    if (event.data.type === "ready" && shell.dataset.preview === "running") shell.dataset.preview = "ready";
    if (event.data.type === "log") {
      state.logs.push({ level: event.data.level, text: String(event.data.text).slice(0, 4000) });
      if (state.logs.length > 200) state.logs.shift();
      renderConsole();
    }
  });

  function renderConsole() {
    consoleList.replaceChildren(
      ...(state.logs.length
        ? state.logs.map((log) => h("li", { class: `ca-log is-${log.level}` }, log.text))
        : [h("li", { class: "ca-log is-empty" }, "Nothing logged yet. console.log() in the lesson's files shows here.")]),
    );
    const errors = state.logs.filter((log) => log.level === "error").length;
    consoleCount.hidden = !state.logs.length;
    consoleCount.textContent = String(state.logs.length);
    consoleCount.classList.toggle("is-error", errors > 0);
  }

  function setTab(tab) {
    state.tab = tab;
    tabPreview.setAttribute("aria-selected", String(tab === "preview"));
    tabConsole.setAttribute("aria-selected", String(tab === "console"));
    frame.hidden = tab !== "preview";
    consoleList.hidden = tab !== "console";
  }

  function setWrap(on) {
    state.wrap = on;
    wrapButton.setAttribute("aria-pressed", String(on));
    editor.wrap(on);
  }

  addEventListener("keydown", (event) => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyZ") {
      event.preventDefault();
      setWrap(!state.wrap);
    }
  });
  function hashStep() {
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      return steps.findIndex((s) => s.id === id);
    } catch {
      return -1;
    }
  }
  addEventListener("hashchange", () => {
    const index = hashStep();
    if (index >= 0 && index !== state.step) go(index, true);
  });
  root.addEventListener("drop:reveal-anchor", (event) => {
    const index = articles.indexOf(event.target.closest(".ca-step"));
    if (index < 0) return;
    if (index !== state.step) go(index);
    event.target.scrollIntoView({ block: "nearest" });
  });

  // ---------- markdown

  function renderMarkdown(markdown) {
    if (!markdown) return "";
    if (!marked) return `<pre class="ca-raw">${escapeHtml(markdown)}</pre>`;
    return marked.parse(markdown, { gfm: true });
  }

  function decorate(body, s) {
    for (const quote of body.querySelectorAll("blockquote")) {
      const first = quote.firstElementChild;
      const kind = first && /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.innerHTML);
      if (!kind) continue;
      first.innerHTML = first.innerHTML.slice(kind[0].length);
      if (!first.innerHTML.trim()) first.remove();
      const type = kind[1].toLowerCase();
      const box = h("div", {
        class: `ca-callout is-${type}`,
        role: "note",
        html: icon({ note: "info", tip: "bulb", important: "info", warning: "alert", caution: "alert" }[type], 16),
      });
      box.append(h("div", { class: "ca-callout-body" }, ...quote.childNodes));
      quote.replaceWith(box);
    }
    for (const link of body.querySelectorAll("a[href]")) {
      const target = parseFileLink(link.getAttribute("href"));
      if (target && s.files[target.path]) {
        link.classList.add("ca-file-link");
        link.dataset.path = target.path;
        // A link that reads as a file name ([main.js]) becomes a file chip; prose ([line 4]) stays a link.
        if (/^\S+$/.test(link.textContent.trim())) link.insertAdjacentHTML("afterbegin", icon("file", 13));
        else link.classList.add("is-text");
        link.addEventListener("click", (event) => {
          event.preventDefault();
          openFile(target.path, target.from ? { from: target.from, to: target.to } : null);
        });
      } else if (/^https?:/i.test(link.getAttribute("href"))) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    }
    for (const table of body.querySelectorAll("table")) {
      const wrapper = h("div", { class: "ca-table" });
      table.replaceWith(wrapper);
      wrapper.append(table);
    }
    if (cm) for (const code of body.querySelectorAll("pre > code")) highlightBlock(code);
  }

  function highlightBlock(code) {
    const lang = /language-([\w+-]+)/.exec(code.className)?.[1];
    const support = lang && cm.language(lang === "javascript" ? "js" : lang === "typescript" ? "ts" : lang);
    const parser = support?.language?.parser;
    if (!parser) return;
    const text = code.textContent;
    const out = document.createDocumentFragment();
    cm.highlight.highlightCode(
      text,
      parser.parse(text),
      cm.highlight.classHighlighter,
      (piece, classes) => out.append(classes ? h("span", { class: classes }, piece) : piece),
      () => out.append("\n"),
    );
    code.replaceChildren(out);
  }

  // ---------- editors

  function codeMirrorEditor(parent) {
    const { EditorView, EditorState, EditorSelection, Compartment, basicSetup, keymap, indentWithTab } = cm;
    const wrapping = new Compartment();
    const states = new Map();
    let key = null;
    const theme = EditorView.theme({
      "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent", color: "var(--ca-fg)" },
      ".cm-scroller": { fontFamily: "var(--ca-mono)", lineHeight: "1.65" },
      ".cm-content": { padding: "8px 0", caretColor: "var(--ca-fg)" },
      ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--ca-faint)" },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px", minWidth: "40px" },
      ".cm-activeLine": { backgroundColor: "var(--ca-line)" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ca-fg)" },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor": { borderLeftColor: "var(--ca-fg)" },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
        { backgroundColor: "var(--ca-selection) !important" },
      ".cm-foldGutter .cm-gutterElement": { color: "var(--ca-faint)" },
      ".cm-tooltip": { border: "1px solid var(--ca-border)", backgroundColor: "var(--ca-popover)", borderRadius: "8px" },
      ".cm-panels": { backgroundColor: "var(--ca-muted)", color: "var(--ca-fg)" },
      ".cm-matchingBracket": { backgroundColor: "var(--ca-selection)", outline: "none" },
    });
    const view = new EditorView({ parent });
    const extensions = (ext) => [
      basicSetup,
      keymap.of([indentWithTab]),
      cm.language(ext),
      cm.syntaxHighlighting(cm.highlight.classHighlighter),
      theme,
      wrapping.of(state.wrap ? EditorView.lineWrapping : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          states.set(key, update.state);
          onEdit(update.state.doc.toString());
        } else if (update.selectionSet) states.set(key, update.state);
        if (update.selectionSet || update.docChanged) renderStatus(cursorOf(update.state));
      }),
    ];
    const cursorOf = (st) => {
      const head = st.selection.main.head;
      const line = st.doc.lineAt(head);
      return { line: line.number, col: head - line.from + 1 };
    };
    return {
      open(next, doc, ext) {
        if (key) states.set(key, view.state);
        key = next;
        let st = states.get(next);
        if (!st || st.doc.toString() !== doc) st = EditorState.create({ doc, extensions: extensions(ext) });
        view.setState(st);
        view.dispatch({ effects: wrapping.reconfigure(state.wrap ? EditorView.lineWrapping : []) });
      },
      forget(prefix) {
        for (const k of [...states.keys()]) if (k.startsWith(prefix)) states.delete(k);
        key = null;
      },
      select(from, to) {
        const doc = view.state.doc;
        const a = doc.line(Math.min(Math.max(1, from), doc.lines));
        const b = doc.line(Math.min(Math.max(1, to ?? from), doc.lines));
        view.dispatch({
          selection: EditorSelection.range(a.from, b.to),
          effects: EditorView.scrollIntoView(a.from, { y: "center" }),
        });
        view.focus();
      },
      wrap(on) {
        view.dispatch({ effects: wrapping.reconfigure(on ? EditorView.lineWrapping : []) });
      },
      cursor: () => cursorOf(view.state),
    };
  }

  function textareaEditor(parent) {
    const area = h("textarea", { class: "ca-textarea", spellcheck: "false", wrap: "off", "aria-label": "Code" });
    parent.append(area);
    const cursor = () => {
      const before = area.value.slice(0, area.selectionStart).split("\n");
      return { line: before.length, col: before.at(-1).length + 1 };
    };
    area.addEventListener("input", () => onEdit(area.value));
    for (const type of ["keyup", "click"]) area.addEventListener(type, () => renderStatus(cursor()));
    return {
      open(_key, doc) {
        area.value = doc;
      },
      forget() {},
      select(from, to) {
        const lines = area.value.split("\n");
        const start = lines.slice(0, from - 1).join("\n").length + (from > 1 ? 1 : 0);
        const end = lines.slice(0, to ?? from).join("\n").length;
        area.focus();
        area.setSelectionRange(start, end);
      },
      wrap(on) {
        area.setAttribute("wrap", on ? "soft" : "off");
      },
      cursor,
    };
  }

  // ---------- start

  setTab("preview");
  const fromHash = hashStep();
  go(fromHash >= 0 ? fromHash : 0, fromHash >= 0);
  window.__lesson = { steps: steps.map((s) => s.id), go: (id) => go(steps.findIndex((s) => s.id === id)) };
  document.body.dataset.ready = cm ? "editor" : "plain";
  root.dispatchEvent(new Event("drop:anchors-ready", { bubbles: true }));
}

function fnv(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

{
  const root = document.getElementById("lesson-root");
  const source = JSON.parse(document.getElementById("lesson").textContent);
  const lesson = parseLesson(source);
  const params = new URLSearchParams(location.search);
  if (params.get("theme")) document.documentElement.dataset.theme = params.get("theme");
  if (lesson.errors.length) {
    root.replaceChildren(
      h(
        "div",
        { class: "ca-shell ca-broken" },
        h("h1", {}, "This lesson has errors"),
        h("ul", {}, ...lesson.errors.map((error) => h("li", {}, error))),
      ),
    );
  } else {
    root.replaceChildren(h("div", { class: "ca-loading" }, "Loading the lesson…"));
    const [markedResult, editorResult] = await Promise.allSettled([
      withTimeout(import("marked"), 10000),
      withTimeout(loadEditorKit(), 15000),
    ]);
    if (editorResult.status === "rejected") console.warn("code-along: the editor didn't load, so it's a plain text box.", editorResult.reason);
    if (markedResult.status === "rejected") console.warn("code-along: the Markdown parser didn't load.", markedResult.reason);
    mount(root, lesson, {
      marked: markedResult.value?.marked ?? null,
      editor: editorResult.value ?? null,
    }, source);
  }
}
