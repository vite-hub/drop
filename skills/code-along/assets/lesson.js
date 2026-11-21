// Reads lesson.md into steps. The page and scripts/build.mjs both run this file, so the build rejects what the page
// couldn't show.
//
// A step is each `##` heading. A fenced block titled with a path (```js [src/main.js]) is a file of that step; a
// fence without a path stays in the guide. A step's files are the step before's files plus its own blocks.

function parseLesson(source) {
  const errors = [];
  const warnings = [];
  let text = String(source).replace(/\r\n?/g, "\n").replace(/^\s*\n/, "");
  const meta = {};
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (front) {
    for (const line of front[1].split("\n")) {
      const pair = /^([\w-]+):\s*(.*)$/.exec(line.trim());
      if (pair) meta[pair[1]] = pair[2].replace(/^(["'])(.*)\1$/, "$2");
    }
    text = text.slice(front[0].length);
  }

  const intro = [];
  const steps = [];
  let step = null;
  let fence = null;
  let lineNo = front ? front[0].split("\n").length - 1 : 0;
  for (const line of text.split("\n")) {
    lineNo++;
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.mark[0]}{${fence.mark.length},}\\s*$`).test(line)) {
        if (fence.file) fence.file.content = fence.body.join("\n") + "\n";
        else (step ? step.guide : intro).push(fence.open, ...fence.body, line);
        fence = null;
      } else fence.body.push(line);
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})\s*([^\s[`{]*)\s*(?:\[([^\]]*)\])?.*$/.exec(line);
    if (open) {
      fence = { mark: open[1], open: line, body: [], file: null };
      const path = open[3] === undefined ? null : normalizePath(open[3]);
      if (open[3] !== undefined) {
        if (!path) errors.push(`line ${lineNo}: "${open[3]}" isn't a file path. Write a relative path such as src/main.js.`);
        else if (!step)
          errors.push(`line ${lineNo}: ${path} sits before the first ## step. Move it under the step that shows it.`);
        else {
          if (step.own.some((file) => file.path === path))
            warnings.push(`step "${step.title}" writes ${path} twice; the last block wins.`);
          fence.file = { path, lang: open[2] || langOf(path), content: "" };
          step.own.push(fence.file);
        }
      }
      continue;
    }
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      step = { title: heading[1], line: lineNo, guide: [], own: [] };
      steps.push(step);
      continue;
    }
    const top = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (top && !step && !meta.title) {
      meta.title = top[1];
      continue;
    }
    (step ? step.guide : intro).push(line);
  }
  if (fence) errors.push(`a fence opened with ${fence.mark} never closes. Close it with ${fence.mark}.`);
  if (!steps.length) errors.push("the lesson has no ## step. Start each step with a ## heading.");

  const used = new Set();
  let files = {};
  let active = null;
  const out = steps.map((s, index) => {
    let id = slug(s.title) || `step-${index + 1}`;
    while (used.has(id)) id += "-2";
    used.add(id);
    const changed = s.own.map((file) => file.path);
    files = { ...files };
    for (const file of s.own) files[file.path] = { content: file.content, lang: file.lang };
    const paths = Object.keys(files).sort(byTree);
    if (!paths.length)
      errors.push(`step "${s.title}" (line ${s.line}) has no files. Give it a fence titled with a path, as \`\`\`js [src/main.js].`);
    const guide = s.guide.join("\n").trim();
    for (const link of linksIn(guide)) {
      if (!paths.includes(link.path))
        errors.push(
          `step "${s.title}" links to ${link.path}, which isn't one of its files (${paths.join(", ") || "none"}).`,
        );
    }
    // The file a step opens on: the first file its text links to, else the first file it changes (index.html last),
    // else the one the step before had open.
    const linked = linksIn(guide).find((link) => paths.includes(link.path))?.path;
    const ownFirst = changed.find((p) => p !== "index.html") ?? changed[0];
    active = linked ?? ownFirst ?? (paths.includes(active) ? active : null) ?? paths.find((p) => p !== "index.html") ?? paths[0] ?? null;
    return {
      id,
      title: s.title,
      guide,
      files: Object.fromEntries(paths.map((p) => [p, files[p]])),
      changed,
      active,
      preferredFile: linked ?? ownFirst ?? null,
    };
  });
  const guideSide = meta.guide === "right" ? "right" : "left";
  if (meta.guide && !/^(left|right)$/.test(meta.guide))
    warnings.push(`guide: ${meta.guide} isn't left or right; the guide sits on the left.`);
  if (!meta.title) warnings.push("the lesson has no title. Add title: to the frontmatter.");
  if (out.length && !out.some((s) => s.files["index.html"]))
    warnings.push("no step has index.html, so the page shows code without a preview.");
  return {
    title: meta.title || "Code along",
    guide: guideSide,
    intro: intro.join("\n").trim(),
    steps: out,
    errors,
    warnings,
  };

  function normalizePath(raw) {
    const path = raw.trim().replace(/^\.\//, "").replace(/^\/+/, "");
    if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path) || /(^|\/)\.\.(\/|$)/.test(path) || /\s/.test(path)) return null;
    return path;
  }
}

// [text](src/main.js) or [text](src/main.js#L3-L5) opens a file; URLs and #anchors are left alone.
function linksIn(markdown) {
  const plain = markdown.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1\s*$/gm, "").replace(/`[^`\n]*`/g, "");
  const links = [];
  for (const match of plain.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = parseFileLink(match[1]);
    if (target) links.push(target);
  }
  return links;
}

function parseFileLink(href) {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(href)) return null;
  const [raw, hash = ""] = href.split("#");
  const path = raw.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!path) return null;
  const lines = /^L(\d+)(?:-L?(\d+))?$/.exec(hash);
  return { path, from: lines ? Number(lines[1]) : null, to: lines ? Number(lines[2] ?? lines[1]) : null };
}

function slug(title) {
  return title
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function byTree(a, b) {
  if (a === "index.html") return -1;
  if (b === "index.html") return 1;
  const pa = a.split("/");
  const pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    const aDir = i < pa.length - 1;
    const bDir = i < pb.length - 1;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return pa[i].localeCompare(pb[i]);
  }
  return pa.length - pb.length;
}

function langOf(path) {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  return (
    { mjs: "js", cjs: "js", jsx: "jsx", tsx: "tsx", htm: "html", yml: "yaml", markdown: "md" }[ext] ?? ext ?? "text"
  );
}
