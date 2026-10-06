// Tiny Markdown renderer for the prototype. Production Drop renders with Comark on the server.
import type { PlanKind } from "./plans";
import { EDITOR_CSS, EDITOR_SCRIPT, injectRuntime, THEME_CSS } from "./plan-runtime";
import { TYPESET_CSS } from "./typeset";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderList(lines: string[], ordered: boolean): string {
  const items = lines.map((line) => {
    const text = line.replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, "");
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      const checked = task[1] !== " " ? " checked" : "";
      return `<li class="task-list-item"><input type="checkbox" disabled${checked}> ${inline(task[2] ?? "")}</li>`;
    }
    return `<li>${inline(text)}</li>`;
  });
  return ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`;
}

function renderTable(lines: string[]): string {
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const [head = "", , ...body] = lines;
  return `<table><thead><tr>${cells(head).map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body
    .map((row) => `<tr>${cells(row).map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/^---\n[\s\S]*?\n---\n?/, "").split("\n");
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      html.push(fence[1] === "mermaid" ? `<pre class="mermaid">${escapeHtml(code.join("\n"))}</pre>` : `<pre data-lang="${escapeHtml(fence[1] || "text")}"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    const collect = (pattern: RegExp) => {
      const block: string[] = [];
      while (index < lines.length && pattern.test(lines[index] ?? "")) {
        block.push(lines[index] ?? "");
        index += 1;
      }
      return block;
    };

    if (line.startsWith(">")) {
      const block = collect(/^>/).map((quoteLine) => quoteLine.replace(/^>\s?/, ""));
      // Accept "[!NOTE]" and the escaped "\[!NOTE\]" that Markdown serializers write.
      const callout = block[0]?.match(/^\\?\[!(\w+)\\?\]/);
      if (callout) {
        const body = block.slice(1).join(" ");
        html.push(`<aside class="callout" data-kind="${escapeHtml((callout[1] ?? "note").toLowerCase())}"><p>${inline(body)}</p></aside>`);
      }
      else {
        html.push(`<blockquote><p>${inline(block.join(" "))}</p></blockquote>`);
      }
      continue;
    }

    if (line.trim().startsWith("|")) {
      html.push(renderTable(collect(/^\s*\|/)));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      html.push(renderList(collect(/^\s*[-*]\s+/), false));
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      html.push(renderList(collect(/^\s*\d+\.\s+/), true));
      continue;
    }

    const paragraph = collect(/^(?!\s*$|#|```|>|\s*[-*]\s|\s*\d+\.\s|\s*\|).+/);
    html.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }

  return html.join("\n");
}

const DOCUMENT_EXTRA_CSS = `
body { margin: 0; background: var(--background); color: var(--foreground); }
main { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
.callout { border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; padding: 0.25rem 1rem; margin: 1.25rem 0; background: var(--card); }
.callout[data-kind="tip"] { border-left-color: var(--info); }
.task-list-item { list-style: none; margin-left: -1.25rem; }
pre.mermaid { background: none; border: 0; display: flex; justify-content: center; }
`;

const MERMAID_SCRIPT = `<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral" });
await mermaid.run({ querySelector: "pre.mermaid" });
</script>`;

/** Editable Markdown document: same typeset and theme as the reader, with TipTap mounted on the article. */
export function editorDocument(source: string, dark = false): string {
  const json = JSON.stringify(source).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en" class="${dark ? "dark" : ""}"><head><meta charset="utf-8"><style>${THEME_CSS}</style><style>${TYPESET_CSS}${THEME_CSS}${DOCUMENT_EXTRA_CSS}${EDITOR_CSS}</style></head><body><main><p id="editor-loading">Loading editor...</p><article class="typeset" id="editor"></article></main><script type="application/json" id="drop-source">${json}</script><script type="module">${EDITOR_SCRIPT}</script></body></html>`;
}

/** Builds the exact document an iframe shows for a plan, with Drop's theme and annotator injected. */
export function planDocument(kind: PlanKind, source: string, dark = false): string {
  if (kind === "html") return injectRuntime(source, dark);
  if (kind === "image") {
    const src = source.trim().startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` : source;
    return injectRuntime(`<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:var(--muted)"><img src="${escapeHtml(src)}" style="max-width:min(100%,960px);box-shadow:0 10px 40px rgb(0 0 0/.15);border-radius:10px" alt=""></body></html>`, dark);
  }
  if (kind === "file") {
    return injectRuntime(`<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;color:var(--muted-foreground)">No preview for this file type.</body></html>`, dark);
  }
  const body = renderMarkdown(source);
  const mermaid = body.includes('class="mermaid"') ? MERMAID_SCRIPT : "";
  // Theme comes after typeset so its tokens win at equal specificity.
  return injectRuntime(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${TYPESET_CSS}${THEME_CSS}${DOCUMENT_EXTRA_CSS}</style></head><body><main><article class="typeset">${body}</article></main>${mermaid}</body></html>`, dark);
}
