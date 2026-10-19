// Serves a project folder inside one sandboxed document, so an app drop behaves like static hosting:
// stylesheets, scripts and SVGs are inlined, ES module imports resolve to inline modules, fetch() of a
// project file returns that file, and links to other pages switch pages.

import { lookup } from "mrmime"
import { prependToHead } from "./plan-runtime.ts"

export type ProjectFiles = Record<string, string>

/** Resolves `ref` relative to the file at `from`. Returns null for external URLs. Embedded in the page runtime. */
export function resolvePath(from: string, ref: string): string | null {
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null
  const clean = ref.split("#")[0]!.split("?")[0]!
  if (!clean) return null
  const parts = clean.startsWith("/") ? [] : from.split("/").slice(0, -1)
  for (const part of clean.replace(/^\//, "").split("/")) {
    if (part === "..") parts.pop()
    else if (part && part !== ".") parts.push(part)
  }
  return parts.join("/")
}

/** The page a URL path opens, the way a static host serves it: `/` and `/docs/` open their index.html. Embedded in the page runtime. */
export function pageAt(pages: string[], path: string): string | null {
  const clean = path.replace(/^\/+/, "")
  const candidates = [clean, `${clean.replace(/\/$/, "")}/index.html`.replace(/^\//, ""), `${clean}.html`]
  return candidates.find((candidate) => candidate && pages.includes(candidate)) ?? null
}

/** The URL path a static host serves `page` at: an index.html at its folder. */
export const pageUrl = (page: string): string => encodeURI(`/${page.replace(/(^|\/)index\.html$/, "$1")}`)

export const contentTypeOf = (path: string): string => lookup(path) ?? "text/plain"

const dataUrl = (path: string, content: string) => `data:${contentTypeOf(path)};charset=utf-8,${encodeURIComponent(content)}`
const safeScript = (code: string) => code.replace(/<\/script/gi, "<\\/script")

function inlineCss(files: ProjectFiles, path: string, css: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, ref: string) => {
    const target = resolvePath(path, ref)
    return target && files[target] !== undefined ? `url("${dataUrl(target, files[target])}")` : match
  })
}

function bundleModule(files: ProjectFiles, path: string, seen: Set<string>): string {
  const code = files[path] ?? ""
  if (seen.has(path)) return code
  const next = new Set(seen).add(path)
  const replace = (specifier: string) => {
    const target = resolvePath(path, specifier)
    if (!target || files[target] === undefined) return specifier
    return target.endsWith(".json") ? dataUrl(target, files[target]) : `data:text/javascript;charset=utf-8,${encodeURIComponent(bundleModule(files, target, next))}`
  }
  return code
    .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+|\/[^'"]+)\2/g, (_match, lead: string, quote: string, specifier: string) => `${lead}${quote}${replace(specifier)}${quote}`)
}

function pageRuntime(files: ProjectFiles, page: string): string {
  const assets = Object.fromEntries(Object.entries(files).filter(([path]) => !path.endsWith(".html")))
  // On the content origin the app has a real URL: links navigate like on any static host, and the viewer follows
  // along. In the opaque sandbox nothing can navigate, so links to other pages ask the viewer to switch.
  return `<script>(() => {
  const resolvePath = ${resolvePath.toString()};
  const pageAt = ${pageAt.toString()};
  const files = ${safeScript(JSON.stringify(assets))};
  const pages = ${safeScript(JSON.stringify(Object.keys(files).filter((path) => path.endsWith(".html"))))};
  const page = ${JSON.stringify(page)};
  const opaque = self.origin === "null";
  const post = (message) => parent.postMessage(Object.assign({ __drop: true }, message), "*");
  const types = { css: "text/css", js: "text/javascript", json: "application/json", svg: "image/svg+xml", md: "text/markdown" };
  const native = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!opaque && url.startsWith(location.origin + "/")) url = url.slice(location.origin.length);
    const path = resolvePath(page, url);
    if (path !== null && path in files) {
      return Promise.resolve(new Response(files[path], { status: 200, headers: { "content-type": types[path.split(".").pop()] || "text/plain" } }));
    }
    return native(input, init);
  };
  if (!opaque) {
    const report = () => post({ type: "location", path: location.pathname });
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        report();
        return result;
      };
    }
    addEventListener("popstate", report);
    // Apps that frame their own pages load the frame host again, one level down. Pass its request up to Drop
    // and the document back down, as many levels as the app nests.
    const waiting = new Map();
    addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.__drop !== true) return;
      if (event.source === parent && message.type === "document" && waiting.has(message.id)) {
        const [frame, id] = waiting.get(message.id);
        waiting.delete(message.id);
        frame.postMessage({ __drop: true, type: "document", id, html: message.html }, location.origin);
      }
      else if (event.source !== parent && event.origin === location.origin && message.type === "runtime-error") post(message);
      else if (event.source !== parent && event.origin === location.origin && (message.type === "host" || message.type === "frame-request")) {
        const id = Math.random().toString(36).slice(2);
        waiting.set(id, [event.source, message.id]);
        post({ type: "frame-request", id, path: message.path });
      }
    });
    return;
  }
  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link || link.target === "_blank") return;
    const path = resolvePath(page, link.getAttribute("href"));
    const target = path === null ? null : pageAt(pages, path);
    if (target !== null) {
      event.preventDefault();
      post({ type: "navigate", path: target });
    }
  }, true);
})();</script>`
}

/** One self-contained HTML document for `page`, ready for injectRuntime (theme + comments). */
export function buildProjectDocument(files: ProjectFiles, page: string): string {
  const source = files[page]
  if (source === undefined) {
    return `<!doctype html><html><head></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:var(--font-sans);color:var(--muted-foreground)">${page} isn't in this project.</body></html>`
  }
  const html = source
    .replace(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
      const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]
      const target = href ? resolvePath(page, href) : null
      return target && files[target] !== undefined ? `<style data-file="${target}">${inlineCss(files, target, files[target])}</style>` : tag
    })
    .replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, before: string, src: string, after: string) => {
      const target = resolvePath(page, src)
      if (!target || files[target] === undefined) return tag
      const isModule = /type=["']?module/i.test(before + after)
      const code = isModule ? bundleModule(files, target, new Set()) : files[target]
      return `<script${isModule ? " type=\"module\"" : ""} data-file="${target}">${safeScript(code)}</script>`
    })
    .replace(/(<(?:img|source|image|use)\b[^>]*?\s(?:src|href)=)(["'])([^"']+)\2/gi, (match, lead: string, quote: string, ref: string) => {
      const target = resolvePath(page, ref)
      return target && files[target] !== undefined ? `${lead}${quote}${dataUrl(target, files[target])}${quote}` : match
    })
  return prependToHead(html, pageRuntime(files, page))
}

const LINK_TAGS: [RegExp, string][] = [
  [/<script\b[^>]*\bsrc=["']([^"']+)["']/gi, "script"],
  [/<link\b[^>]*\bhref=["']([^"']+)["']/gi, "stylesheet or icon"],
  [/<(?:img|source|image|use|video|audio|iframe)\b[^>]*?\s(?:src|href)=["']([^"']+)["']/gi, "image or media"],
]

/**
 * References in the sent files that point at nothing in the app, the way the viewer resolves them: a script,
 * stylesheet, image, CSS url(), module import, fetch() of a literal path, or a link to a page. Also bare module
 * imports ("react") without an import map, which no browser can load. Template-built paths are skipped. Each issue
 * is one sentence an agent can act on.
 */
export function appLinkIssues(sent: ProjectFiles, paths: string[]): string[] {
  const all = new Set(paths)
  const pages = paths.filter((path) => path.endsWith(".html"))
  const importMap = Object.entries(sent).some(([path, text]) => path.endsWith(".html") && /<script\b[^>]*type=["']?importmap/i.test(text))
  const issues = new Set<string>()
  const check = (from: string, ref: string, what: string, page = false) => {
    if (/[`$]|\{\{/.test(ref)) return
    const target = resolvePath(from, ref.trim())
    if (target === null || target === "" && !page) return
    if (all.has(target) || (page && pageAt(pages, `/${target}`) !== null)) return
    issues.add(`${from} ${page ? "links to" : `loads ${what}`} "${ref}", but ${target || "index.html"} isn't in the app.`)
  }
  for (const [path, text] of Object.entries(sent)) {
    if (path.endsWith(".html") || path.endsWith(".htm")) {
      const html = text.replace(/<!--[\s\S]*?-->/g, "")
      for (const [pattern, what] of LINK_TAGS) for (const match of html.matchAll(pattern)) check(path, match[1]!, what)
      for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) check(path, match[1]!, "", true)
      for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) scanScript(path, match[1]!)
    }
    else if (path.endsWith(".css")) {
      for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) if (!match[2]!.startsWith("data:")) check(path, match[2]!, "a file")
    }
    else if (/\.m?js$/.test(path)) scanScript(path, text)
  }
  function scanScript(path: string, code: string) {
    for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g)) {
      const specifier = match[2]!
      if (/^(?:\.{1,2}\/|\/)/.test(specifier)) check(path, specifier, "a module")
      else if (!importMap && !/^[a-z][a-z0-9+.-]*:/i.test(specifier))
        issues.add(`${path} imports "${specifier}", a bare module name that browsers can't load. Import it from a CDN URL (https://esm.sh/${specifier}) or add an import map.`)
    }
    for (const match of code.matchAll(/\bfetch\(\s*(['"])([^'"]+)\1/g)) check(path, match[2]!, "data from")
  }
  return [...issues].slice(0, 20)
}
