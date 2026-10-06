// Serves a project folder inside one sandboxed document, so the prototype behaves like static hosting:
// stylesheets, scripts and SVGs are inlined, ES module imports resolve to inline modules, fetch() of a
// project file returns that file, and links to other .html pages switch pages.
// Real Drop serves the same folder from Blob at /s/:project/*, where none of this is needed.

export type ProjectFiles = Record<string, string>;

/** Resolves `ref` relative to the file at `from`. Returns null for external URLs. Embedded in the page runtime. */
export function resolvePath(from: string, ref: string): string | null {
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
  const clean = ref.split("#")[0]!.split("?")[0]!;
  if (!clean) return null;
  const parts = clean.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of clean.replace(/^\//, "").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export function contentTypeOf(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return ({ html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json", svg: "image/svg+xml", md: "text/markdown", txt: "text/plain" } as Record<string, string>)[extension] ?? "text/plain";
}

const dataUrl = (path: string, content: string) => `data:${contentTypeOf(path)};charset=utf-8,${encodeURIComponent(content)}`;
const safeScript = (code: string) => code.replace(/<\/script/gi, "<\\/script");

function inlineCss(files: ProjectFiles, path: string, css: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, ref: string) => {
    const target = resolvePath(path, ref);
    return target && files[target] !== undefined ? `url("${dataUrl(target, files[target]!)}")` : match;
  });
}

function bundleModule(files: ProjectFiles, path: string, seen: Set<string>): string {
  const code = files[path] ?? "";
  if (seen.has(path)) return code;
  const next = new Set(seen).add(path);
  const replace = (specifier: string) => {
    const target = resolvePath(path, specifier);
    if (!target || files[target] === undefined) return specifier;
    return target.endsWith(".json") ? dataUrl(target, files[target]!) : `data:text/javascript;charset=utf-8,${encodeURIComponent(bundleModule(files, target, next))}`;
  };
  return code
    .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+|\/[^'"]+)\2/g, (_match, lead: string, quote: string, specifier: string) => `${lead}${quote}${replace(specifier)}${quote}`);
}

function pageRuntime(files: ProjectFiles, page: string): string {
  const assets = Object.fromEntries(Object.entries(files).filter(([path]) => !path.endsWith(".html")));
  return `<script>(() => {
  const resolvePath = ${resolvePath.toString()};
  const files = ${safeScript(JSON.stringify(assets))};
  const pages = ${safeScript(JSON.stringify(Object.keys(files).filter((path) => path.endsWith(".html"))))};
  const page = ${JSON.stringify(page)};
  const types = { css: "text/css", js: "text/javascript", json: "application/json", svg: "image/svg+xml", md: "text/markdown" };
  const native = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = resolvePath(page, url);
    if (path !== null && path in files) {
      return Promise.resolve(new Response(files[path], { status: 200, headers: { "content-type": types[path.split(".").pop()] || "text/plain" } }));
    }
    return native(input, init);
  };
  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link || link.target === "_blank") return;
    const path = resolvePath(page, link.getAttribute("href"));
    if (path !== null && pages.includes(path)) {
      event.preventDefault();
      parent.postMessage({ __drop: true, type: "navigate", path }, "*");
    }
  }, true);
})();</script>`;
}

/** One self-contained HTML document for `page`, ready for injectRuntime (theme + comments). */
export function buildProjectDocument(files: ProjectFiles, page: string): string {
  const source = files[page];
  if (source === undefined) {
    return `<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:var(--font-sans);color:var(--muted-foreground)">${page} isn't in this project.</body></html>`;
  }
  let html = source
    .replace(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
      const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
      const target = href ? resolvePath(page, href) : null;
      return target && files[target] !== undefined ? `<style data-file="${target}">${inlineCss(files, target, files[target]!)}</style>` : tag;
    })
    .replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, before: string, src: string, after: string) => {
      const target = resolvePath(page, src);
      if (!target || files[target] === undefined) return tag;
      const isModule = /type=["']?module/i.test(before + after);
      const code = isModule ? bundleModule(files, target, new Set()) : files[target]!;
      return `<script${isModule ? ' type="module"' : ""} data-file="${target}">${safeScript(code)}</script>`;
    })
    .replace(/(<(?:img|source|image|use)\b[^>]*?\s(?:src|href)=)(["'])([^"']+)\2/gi, (match, lead: string, quote: string, ref: string) => {
      const target = resolvePath(page, ref);
      return target && files[target] !== undefined ? `${lead}${quote}${dataUrl(target, files[target]!)}${quote}` : match;
    });
  const runtime = pageRuntime(files, page);
  html = /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (match) => match + runtime) : runtime + html;
  return html;
}
