// A small multi-file app that exercises everything a project serves:
// two pages, a stylesheet, ES modules importing each other, fetch() of a JSON file, and an SVG asset.
export const DEMO_PROJECT_FILES: Record<string, string> = {
  "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Launch board</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top">
    <img src="logo.svg" alt="Launch board logo" width="28" height="28">
    <strong>Launch board</strong>
    <nav><a href="index.html" aria-current="page">Board</a><a href="about.html">About</a></nav>
  </header>
  <main>
    <p class="eyebrow">Drop v2 · launch</p>
    <h1>Ships in <span id="countdown">…</span></h1>
    <p class="lede">Everything left before the auth launch. Click a task to mark it done.</p>
    <ul id="tasks" class="tasks"></ul>
    <p class="meta" id="progress"></p>
  </main>
  <script type="module" src="app.js"></script>
</body>
</html>`,
  "about.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>About · Launch board</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top">
    <img src="logo.svg" alt="Launch board logo" width="28" height="28">
    <strong>Launch board</strong>
    <nav><a href="index.html">Board</a><a href="about.html" aria-current="page">About</a></nav>
  </header>
  <main>
    <p class="eyebrow">About</p>
    <h1>Built by an agent, hosted by Drop</h1>
    <p class="lede">Claude Code built this folder: two pages, a stylesheet, ES modules, and a JSON file. Drop serves it as a static site, private until you share it.</p>
  </main>
</body>
</html>`,
  "style.css": `.top { display: flex; align-items: center; gap: 10px; padding: 14px 24px; border-bottom: 1px solid var(--border); }
.top nav { margin-left: auto; display: flex; gap: 4px; }
.top nav a { color: var(--muted-foreground); text-decoration: none; padding: 6px 10px; border-radius: 6px; font-size: 14px; }
.top nav a[aria-current="page"] { color: var(--foreground); background: var(--muted); }
main { max-width: 640px; margin: 0 auto; padding: 56px 24px 96px; }
.eyebrow { font: 500 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted-foreground); }
h1 { font-size: 36px; letter-spacing: -0.03em; margin: 12px 0; }
.lede { color: var(--muted-foreground); font-size: 16px; }
.tasks { list-style: none; padding: 0; margin: 28px 0 0; border: 1px solid var(--border); border-radius: var(--radius); }
.tasks li { display: flex; gap: 12px; align-items: center; padding: 12px 16px; cursor: pointer; }
.tasks li + li { border-top: 1px solid var(--border); }
.tasks li.done span { text-decoration: line-through; color: var(--muted-foreground); }
.tasks input { accent-color: var(--foreground); }
.tasks small { margin-left: auto; font: 12px var(--font-mono); color: var(--muted-foreground); }
.meta { font: 12px var(--font-mono); color: var(--muted-foreground); margin-top: 12px; }`,
  "app.js": `import { countdown, plural } from "./lib/format.js";

const target = Date.now() + 3 * 864e5 + 5 * 36e5;
const tick = () => { document.getElementById("countdown").textContent = countdown(target); };
tick();
setInterval(tick, 1000);

const tasks = await fetch("./data.json").then((response) => response.json());
const list = document.getElementById("tasks");
const progress = document.getElementById("progress");
const render = () => {
  list.innerHTML = "";
  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = task.done ? "done" : "";
    item.innerHTML = \`<input type="checkbox" \${task.done ? "checked" : ""}><span></span><small></small>\`;
    item.querySelector("span").textContent = task.title;
    item.querySelector("small").textContent = task.owner;
    item.onclick = () => { task.done = !task.done; render(); };
    list.appendChild(item);
  }
  const left = tasks.filter((task) => !task.done).length;
  progress.textContent = \`\${plural(left, "task")} left\`;
};
render();`,
  "lib/format.js": `export function countdown(target) {
  const ms = Math.max(0, target - Date.now());
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  return \`\${d}d \${h}h \${m}m \${String(s).padStart(2, "0")}s\`;
}

export const plural = (count, word) => \`\${count} \${word}\${count === 1 ? "" : "s"}\`;`,
  "data.json": `[
  { "title": "Record uploads in D1", "owner": "Claude Code", "done": true },
  { "title": "Sign in with GitHub", "owner": "Claude Code", "done": true },
  { "title": "Require auth to upload", "owner": "Codex", "done": false },
  { "title": "Private by default", "owner": "Claude Code", "done": false },
  { "title": "Write the announcement", "owner": "You", "done": false }
]`,
  "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#18181b"/><path d="M9 18l5 5 9-12" fill="none" stroke="#fafafa" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};

export const BLANK_PROJECT_FILES: Record<string, string> = {
  "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>New project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello from Drop</h1>
    <p id="message"></p>
  </main>
  <script type="module" src="app.js"></script>
</body>
</html>`,
  "style.css": `main { max-width: 640px; margin: 0 auto; padding: 56px 24px; }
h1 { letter-spacing: -0.03em; }`,
  "app.js": `document.getElementById("message").textContent = "Edit app.js, then save to publish a new version.";`
};

// Drop itself as a static, clickable mock: the kind of folder an agent drops while prototyping a UI.
export const DROP_MOCK_FILES: Record<string, string> = {
  "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Drop mock · Drops</title>
  <link rel="stylesheet" href="styles/app.css">
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <strong class="brand">Drop</strong>
      <p class="label">Workspace</p>
      <a href="index.html" aria-current="page">Drops</a>
      <a href="viewer.html">Viewer</a>
      <p class="label">Settings</p>
      <a href="#">Agents</a>
    </aside>
    <main>
      <h1>Drops</h1>
      <p class="muted">A static mock built by an agent. Toggles are saved in this browser.</p>
      <div class="filters" id="filters"></div>
      <ul class="rows" id="rows"></ul>
    </main>
  </div>
  <script type="module" src="scripts/list.js"></script>
</body>
</html>`,
  "viewer.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Drop mock · Viewer</title>
  <link rel="stylesheet" href="styles/app.css">
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <strong class="brand">Drop</strong>
      <p class="label">Workspace</p>
      <a href="index.html">Drops</a>
      <a href="viewer.html" aria-current="page">Viewer</a>
    </aside>
    <main>
      <p class="label">Doc · v2</p>
      <h1>Auth for Drop, stacked rollout</h1>
      <p>Seven small PRs, each deployed to a preview and tested before the next one starts.</p>
      <blockquote>Ship the skill update in the same PR. Agents break the moment auth lands. <cite>Ana</cite></blockquote>
    </main>
  </div>
</body>
</html>`,
  "styles/app.css": `.shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; }
.sidebar { border-right: 1px solid var(--border); padding: 16px 12px; display: flex; flex-direction: column; gap: 2px; background: var(--card); }
.brand { padding: 4px 8px 12px; }
.label { font: 500 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted-foreground); margin: 14px 8px 6px; }
.sidebar a { color: var(--muted-foreground); text-decoration: none; padding: 6px 8px; border-radius: 6px; font-size: 14px; }
.sidebar a[aria-current="page"] { background: var(--muted); color: var(--foreground); }
main { padding: 32px 40px; max-width: 760px; }
h1 { font-size: 26px; letter-spacing: -0.02em; margin: 6px 0 4px; }
.muted { color: var(--muted-foreground); }
.filters { display: inline-flex; gap: 4px; background: var(--muted); padding: 4px; border-radius: 8px; margin: 20px 0 12px; }
.filters button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 6px; font-size: 13px; color: var(--muted-foreground); }
.filters button[aria-pressed="true"] { background: var(--card); color: var(--foreground); box-shadow: 0 0 0 1px var(--border); }
.rows { list-style: none; padding: 0; margin: 0; border: 1px solid var(--border); border-radius: var(--radius); }
.rows li { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.rows li + li { border-top: 1px solid var(--border); }
.rows small { font: 12px var(--font-mono); color: var(--muted-foreground); }
.toggle { margin-left: auto; width: 34px; height: 20px; border-radius: 99px; background: var(--border); position: relative; cursor: pointer; border: 0; }
.toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 99px; background: var(--card); transition: transform 150ms; }
.toggle[aria-checked="true"] { background: var(--primary); }
.toggle[aria-checked="true"]::after { transform: translateX(14px); background: var(--primary-foreground); }
blockquote { border-left: 2px solid var(--border); margin: 24px 0; padding-left: 14px; color: var(--muted-foreground); }`,
  "scripts/list.js": `import { load, save } from "./store.js";

const drops = await fetch("data/drops.json").then((response) => response.json());
const state = load(drops);
let filter = "all";
const rows = document.getElementById("rows");
const filters = document.getElementById("filters");

function render() {
  filters.innerHTML = "";
  for (const name of ["all", "private", "shared"]) {
    const button = document.createElement("button");
    button.textContent = name[0].toUpperCase() + name.slice(1);
    button.setAttribute("aria-pressed", String(filter === name));
    button.onclick = () => { filter = name; render(); };
    filters.appendChild(button);
  }
  rows.innerHTML = "";
  for (const drop of drops.filter((d) => filter === "all" || (filter === "shared") === state[d.id])) {
    const row = document.createElement("li");
    row.innerHTML = "<div><div></div><small></small></div><button class='toggle' role='switch'></button>";
    row.querySelector("div div").textContent = drop.title;
    row.querySelector("small").textContent = drop.kind + " · " + drop.by;
    const toggle = row.querySelector(".toggle");
    toggle.setAttribute("aria-checked", String(state[drop.id]));
    toggle.setAttribute("aria-label", "Share " + drop.title);
    toggle.onclick = () => { state[drop.id] = !state[drop.id]; save(state); render(); };
    rows.appendChild(row);
  }
}
render();`,
  "scripts/store.js": `const KEY = "drop-mock-shared";

export function load(drops) {
  try { return { ...Object.fromEntries(drops.map((d) => [d.id, d.shared])), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return Object.fromEntries(drops.map((d) => [d.id, d.shared])); }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}`,
  "data/drops.json": `[
  { "id": "auth", "title": "Auth for Drop, stacked rollout", "kind": "Doc", "by": "Claude Code", "shared": false },
  { "id": "network", "title": "Network review, revised", "kind": "Doc", "by": "Codex", "shared": true },
  { "id": "launch", "title": "Launch board", "kind": "App", "by": "Claude Code", "shared": true }
]`
};
