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

// ---------- the module runner inside the preview
//
// Drop serves an HTML drop with a Content-Security-Policy that allows inline and https: scripts but no data: or blob:
// URLs, so a lesson's files can't import each other as real modules. The preview turns each JS file into an async
// function instead: `import` becomes an awaited call that returns the other file's exports, and `export` defines a
// getter. URLs and bare names (from esm.sh) still load as real modules.

function toAsyncModule(code) {
  const exported = [];
  let n = 0;
  const lines = (text) => "\n".repeat((text.match(/\n/g) || []).length);
  const bindings = (list, from) =>
    list
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, alias] = part.split(/\s+as\s+/);
        return [name.trim(), (alias || name).trim()];
      });
  code = code.replace(/\bimport\.meta\b/g, "__meta");
  code = code.replace(
    /^([ \t]*)export\s*\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\3[ \t]*;?/gm,
    (match, indent, list, _q, spec) => {
      const m = `__m${n++}`;
      return `${indent}const ${m} = await __import(${JSON.stringify(spec)});${bindings(list)
        .map(([name, alias]) => `__export(${JSON.stringify(alias)}, () => ${m}[${JSON.stringify(name)}]);`)
        .join("")}${lines(match)}`;
    },
  );
  code = code.replace(
    /^([ \t]*)export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*(['"])([^'"\n]+)\3[ \t]*;?/gm,
    (match, indent, ns, _q, spec) => {
      const m = `__m${n++}`;
      return `${indent}const ${m} = await __import(${JSON.stringify(spec)});${
        ns
          ? `__export(${JSON.stringify(ns)}, () => ${m});`
          : `for (const k of Object.keys(${m})) if (k !== "default") __export(k, () => ${m}[k]);`
      }${lines(match)}`;
    },
  );
  code = code.replace(
    /^([ \t]*)import\s+(?:([\w$]+)\s*,?\s*)?(\{[^}]*\}|\*\s*as\s+[\w$]+)?\s*from\s*(['"])([^'"\n]+)\4[ \t]*;?/gm,
    (match, indent, def, rest, _q, spec) => {
      const m = `__m${n++}`;
      let out = `${indent}const ${m} = await __import(${JSON.stringify(spec)});`;
      if (def) out += `const ${def} = ${m}.default;`;
      if (rest && rest.startsWith("{"))
        out += `const { ${bindings(rest.slice(1, -1))
          .map(([name, alias]) => (name === alias ? name : `${name}: ${alias}`))
          .join(", ")} } = ${m};`;
      else if (rest) out += `const ${rest.replace(/^\*\s*as\s+/, "")} = ${m};`;
      return out + lines(match);
    },
  );
  code = code.replace(
    /^([ \t]*)import\s*(['"])([^'"\n]+)\2[ \t]*;?/gm,
    (_m, indent, _q, spec) => `${indent}await __import(${JSON.stringify(spec)});`,
  );
  code = code.replace(/\bimport\s*\(/g, "__import(");
  code = code.replace(
    /^([ \t]*)export\s+default\s+(async\s+function\b\*?|function\b\*?|class\b)\s*([\w$]+)/gm,
    (_m, indent, kind, name) => (exported.push(["default", name]), `${indent}${kind} ${name}`),
  );
  code = code.replace(/^([ \t]*)export\s+default\s+/gm, "$1__exports.default = ");
  code = code.replace(
    /^([ \t]*)export\s+(const|let|var|async\s+function\*?|function\*?|class)\s+([\w$]+)/gm,
    (_m, indent, kind, name) => (exported.push([name, name]), `${indent}${kind} ${name}`),
  );
  code = code.replace(/^([ \t]*)export\s*\{([^}]*)\}[ \t]*;?/gm, (match, indent, list) => {
    for (const [name, alias] of bindings(list)) exported.push([alias, name]);
    return indent + lines(match);
  });
  const head = exported.map(([name, local]) => `__export(${JSON.stringify(name)}, () => ${local});`).join("");
  return `"use strict";${head}${code}`;
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

function previewRuntime(files) {
  return `(() => {
  const files = ${JSON.stringify(files).replace(/</g, "\\u003c")};
  const resolvePath = ${resolvePath.toString()};
  const toAsyncModule = ${toAsyncModule.toString()};
  const post = (message) => parent.postMessage(Object.assign({ __codeAlong: true }, message), "*");
  const show = (value) => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack && value.stack.includes(value.message) ? value.stack : value.name + ": " + value.message;
    try { const text = JSON.stringify(value, (k, v) => typeof v === "bigint" ? v + "n" : v); return text === undefined ? String(value) : text; } catch { return String(value); }
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => { post({ type: "log", level, text: args.map(show).join(" ") }); original(...args); };
  }
  addEventListener("error", (event) => post({ type: "log", level: "error", text: event.error ? show(event.error) : event.message }));
  addEventListener("unhandledrejection", (event) => post({ type: "log", level: "error", text: "Uncaught (in promise) " + show(event.reason) }));
  const types = { css: "text/css", js: "text/javascript", json: "application/json", svg: "image/svg+xml", md: "text/markdown", html: "text/html" };
  const native = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = resolvePath("index.html", url);
    if (path !== null && path in files)
      return Promise.resolve(new Response(files[path], { status: 200, headers: { "content-type": types[path.split(".").pop()] || "text/plain" } }));
    return native(input, init);
  };
  const AsyncFunction = (async () => {}).constructor;
  const mapped = () => !!document.querySelector('script[type="importmap"]');
  const modules = new Map();
  const load = (path) => {
    if (modules.has(path)) return modules.get(path).ready;
    const exports = Object.create(null);
    const record = { exports, ready: null };
    modules.set(path, record);
    record.ready = (async () => {
      let run;
      try {
        run = new AsyncFunction("__import", "__export", "__exports", "__meta", toAsyncModule(files[path]) + "\\n//# sourceURL=" + path);
      } catch (error) {
        // The engine can't say where a syntax error is in code it compiles from a string; name the file at least.
        const named = new SyntaxError(path + ": " + error.message);
        named.stack = named.name + ": " + named.message;
        throw named;
      }
      const imp = (spec) => {
        if (/^(?:\\.{1,2}\\/|\\/)/.test(spec)) {
          const target = resolvePath(path, spec);
          if (target in files) {
            if (target.endsWith(".json")) return Promise.resolve({ default: JSON.parse(files[target]) });
            if (target.endsWith(".css")) {
              document.head.append(Object.assign(document.createElement("style"), { textContent: files[target] }));
              return Promise.resolve({});
            }
            const other = modules.get(target);
            return other ? Promise.resolve(other.exports) : load(target);
          }
          return Promise.reject(new Error(path + " imports " + spec + ", which isn't a file of this step."));
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return import(spec);
        return import(mapped() ? spec : "https://esm.sh/" + spec);
      };
      await run(imp, (name, get) => Object.defineProperty(exports, name, { enumerable: true, get }), exports, { url: path });
      return exports;
    })();
    return record.ready;
  };
  const queue = [];
  let started = false;
  const drain = async () => {
    started = true;
    while (queue.length) {
      const path = queue.shift();
      try { await load(path); } catch (error) { post({ type: "log", level: "error", text: show(error) }); }
    }
  };
  window.__codeAlong = {
    entry(path) {
      queue.push(path);
      if (document.readyState === "loading") { if (queue.length === 1) addEventListener("DOMContentLoaded", drain, { once: true }); }
      else if (queue.length === 1) drain();
    },
  };
  addEventListener("load", () => post({ type: "loaded" }));
})();`;
}

function previewDocument(files) {
  const page = "index.html";
  const scripts = Object.fromEntries(Object.entries(files).filter(([path]) => !path.endsWith(".html")));
  let inline = 0;
  const safe = (code) => code.replace(/<\/script/gi, "<\\/script");
  let html = files[page]
    .replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/\brel=["']?stylesheet/i.test(tag)) return tag;
      const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
      const target = href ? resolvePath(page, href) : null;
      return target && files[target] !== undefined ? `<style data-file="${target}">${files[target]}</style>` : tag;
    })
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs, body) => {
      const src = /\bsrc=["']([^"']+)["']/i.exec(attrs)?.[1];
      const isModule = /\btype=["']?module/i.test(attrs);
      if (src) {
        const target = resolvePath(page, src);
        if (!target || files[target] === undefined) return tag;
        return isModule
          ? `<script>__codeAlong.entry(${JSON.stringify(target)})</script>`
          : `<script data-file="${target}">${safe(files[target])}\n//# sourceURL=${target}</script>`;
      }
      if (!isModule) return tag;
      const path = `index.html#module-${++inline}`;
      scripts[path] = body;
      return `<script>__codeAlong.entry(${JSON.stringify(path)})</script>`;
    })
    .replace(/(<(?:img|source|image|use)\b[^>]*?\s(?:src|href)=)(["'])([^"']+)\2/gi, (match, lead, quote, ref) => {
      const target = resolvePath(page, ref);
      return target && files[target] !== undefined && target.endsWith(".svg")
        ? `${lead}${quote}data:image/svg+xml;charset=utf-8,${encodeURIComponent(files[target])}${quote}`
        : match;
    });
  const runtime = `<script>${safe(previewRuntime(scripts))}</script>`;
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (tag) => tag + runtime);
  else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${runtime}</head>`);
  else html = `<!doctype html><head><meta charset="utf-8">${runtime}</head><body>${html}</body>`;
  return html;
}

// ---------- the page

function mount(root, lesson, kit) {
  const { marked } = kit;
  const cm = kit.editor;
  const storeKey = `code-along:${fnv(document.getElementById("lesson").textContent)}`;
  let edits = {};
  try {
    edits = JSON.parse(localStorage.getItem(storeKey) || "{}") || {};
  } catch {}
  const saveEdits = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(edits));
    } catch {}
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
        history.replaceState(null, "", `#${s.id}`);
      } catch {}
    const hasPreview = Boolean(s.files["index.html"]);
    shell.toggleAttribute("data-no-preview", !hasPreview);
    renderTree();
    // Keep the open file when the step changes nothing; otherwise open the file the step is about.
    openFile(s.files[state.file] && !s.changed.length ? state.file : s.active);
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
  function runPreview(now = false) {
    clearTimeout(timer);
    const s = step();
    if (!s.files["index.html"]) return;
    const run = () => {
      state.logs = [];
      renderConsole();
      shell.dataset.preview = "running";
      frame.srcdoc = previewDocument(filesOf(s));
    };
    if (now) run();
    else timer = setTimeout(run, 350);
  }

  frame.addEventListener("load", () => (shell.dataset.preview = "ready"));
  addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || !event.data || event.data.__codeAlong !== true) return;
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
  addEventListener("hashchange", () => {
    const index = steps.findIndex((s) => `#${s.id}` === location.hash);
    if (index >= 0 && index !== state.step) go(index, true);
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
    for (const table of body.querySelectorAll("table")) table.replaceWith(h("div", { class: "ca-table" }, table.cloneNode(true)));
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
  const fromHash = steps.findIndex((s) => `#${s.id}` === location.hash);
  go(fromHash >= 0 ? fromHash : 0, fromHash >= 0);
  window.__lesson = { steps: steps.map((s) => s.id), go: (id) => go(steps.findIndex((s) => s.id === id)) };
  document.body.dataset.ready = cm ? "editor" : "plain";
}

function fnv(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

{
  const root = document.getElementById("lesson-root");
  const source = document.getElementById("lesson").textContent.replace(/<\\\/script/gi, "</script");
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
    });
  }
}
