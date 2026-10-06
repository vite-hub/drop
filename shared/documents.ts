// The documents the viewer's sandboxed iframe shows. Markdown arrives already rendered by the server's Comark
// renderer (see server/utils/markdown-document.ts), so every Markdown drop looks the same at /f/ and in Drop.
import { escapeUTF8 as escapeHtml } from "entities";
import type { PlanKind } from "./plans";
import { EDITOR_CSS, EDITOR_SCRIPT, injectRuntime, THEME_CSS } from "./plan-runtime";
import { CALLOUT_CSS, TYPESET_CSS } from "./typeset";

const DOCUMENT_EXTRA_CSS = CALLOUT_CSS + `
body { margin: 0; background: var(--background); color: var(--foreground); }
main { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
.task-list-item { list-style: none; margin-left: -1.25rem; }
.mermaid { display: flex; justify-content: center; margin: 1.5rem 0; }
.mermaid svg { max-width: 100%; height: auto; }
`;

/** Editable Markdown document: same typeset and theme as the reader, with TipTap mounted on the article. */
export function editorDocument(source: string, dark = false): string {
  const json = JSON.stringify(source).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en" class="${dark ? "dark" : ""}"><head><meta charset="utf-8"><style>${THEME_CSS}</style><style>${TYPESET_CSS}${THEME_CSS}${DOCUMENT_EXTRA_CSS}${EDITOR_CSS}</style></head><body><main><p id="editor-loading">Loading editor...</p><article class="typeset" id="editor"></article></main><script type="application/json" id="drop-source">${json}</script><script type="module">${EDITOR_SCRIPT}</script></body></html>`;
}

/** Builds the exact document an iframe shows for a drop, with Drop's theme and annotator injected. `html` is the
 * server-rendered body for Markdown. */
export function planDocument(kind: PlanKind, source: string, dark = false, html = ""): string {
  if (kind === "html") return injectRuntime(source, dark);
  if (kind === "image") {
    const src = source.trim().startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` : source;
    return injectRuntime(`<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:var(--muted)"><img src="${escapeHtml(src)}" style="max-width:min(100%,960px);box-shadow:0 10px 40px rgb(0 0 0/.15);border-radius:10px" alt=""></body></html>`, dark);
  }
  if (kind === "file") {
    return injectRuntime(`<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;color:var(--muted-foreground)">No preview for this file type.</body></html>`, dark);
  }
  // Theme comes after typeset so its tokens win at equal specificity.
  return injectRuntime(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${TYPESET_CSS}${THEME_CSS}${DOCUMENT_EXTRA_CSS}</style></head><body><main><article class="typeset">${html}</article></main></body></html>`, dark);
}
