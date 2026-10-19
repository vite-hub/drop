// The documents the viewer's sandboxed iframe shows. Markdown arrives already rendered by the server's Comark
// renderer (see server/utils/markdown-document.ts), so every Markdown drop looks the same at /f/ and in Drop.
import { escapeUTF8 as escapeHtml } from "entities";
import type { PlanKind } from "./plans";
import { injectRuntime, THEME_CSS } from "./plan-runtime";
import { CALLOUT_CSS, TYPESET_CSS } from "./typeset";

const DOCUMENT_EXTRA_CSS = CALLOUT_CSS + `
/* The text moves left only as far as it must to clear the viewer's floating panel (--drop-inset). Once the column
   can't fit beside it, the column narrows: the panel never covers the text. */
body { margin: 0; background: var(--background); color: var(--foreground); transition: padding-right .2s ease-out;
  padding-right: clamp(0px, calc(2 * var(--drop-inset, 0px) + 46rem - 100vw), max(0px, calc(var(--drop-inset, 0px) - 1.5rem))); }
main { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
.task-list-item { list-style: none; margin-left: -1.25rem; }
.mermaid { display: flex; justify-content: center; margin: 1.5rem 0; }
.mermaid svg { max-width: 100%; height: auto; }
`;

/** Builds the exact document an iframe shows for a drop, with Drop's theme and annotator injected. `html` is the
 * server-rendered body for Markdown. */
export function planDocument(kind: PlanKind, source: string, dark = false, html = "", inset = 0): string {
  if (kind === "html") return injectRuntime(source, dark, inset);
  if (kind === "image") {
    const src = source.trim().startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` : source;
    return injectRuntime(`<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:var(--muted)"><img src="${escapeHtml(src)}" style="max-width:min(100%,960px);box-shadow:0 10px 40px rgb(0 0 0/.15);border-radius:10px" alt=""></body></html>`, dark);
  }
  if (kind === "file") {
    return injectRuntime(`<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;color:var(--muted-foreground)">No preview for this file type.</body></html>`, dark);
  }
  // Theme comes after typeset so its tokens win at equal specificity.
  return injectRuntime(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${TYPESET_CSS}${THEME_CSS}${DOCUMENT_EXTRA_CSS}</style></head><body><main><article class="typeset">${html}</article></main></body></html>`, dark, inset);
}
