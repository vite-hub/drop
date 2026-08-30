import type { NodeHandler } from "@comark/html/render"
import { renderHtmlFromDocument } from "@comark/html"
import { parseMarkdown } from "@comark/html/parse"
import alert from "@comark/html/plugins/alert"
import attributes from "@comark/html/plugins/attributes"
import components from "@comark/html/plugins/components"
import frontmatter from "@comark/html/plugins/frontmatter"
import mermaid from "@comark/html/plugins/mermaid"
import security from "@comark/html/plugins/security"
import taskList from "@comark/html/plugins/task-list"
import { renderMermaidSVG } from "beautiful-mermaid"

const ALLOWED_TAGS = [
  "a",
  "alert",
  "blockquote",
  "br",
  "callout",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "info",
  "input",
  "li",
  "mermaid",
  "note",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tip",
  "tr",
  "ul",
  "warning",
]

const plugins = [
  frontmatter(),
  alert(),
  taskList(),
  components(),
  attributes(),
  mermaid(),
  security({
    allowedProtocols: ["http", "https", "mailto"],
    allowedTags: ALLOWED_TAGS,
    tagFallback: ([tag, , ...children]) => [
      "aside",
      { class: "unsupported-component" },
      `Unsupported component: ${tag}. `,
      ...children,
    ],
  }),
] as const

const DOCUMENT_STYLES = `
:root {
  color-scheme: light;
  font-family: Charter, Georgia, "Times New Roman", serif;
  color: #141413;
  background: #f5f4ed;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-width: 18rem;
  background:
    linear-gradient(to bottom, rgba(80, 78, 73, 0.045) 1px, transparent 1px) 0 6.2rem / 100% 2rem,
    #f5f4ed;
}

a { color: #1b365d; text-underline-offset: 0.18em; }
a:hover { color: #2d5a8a; }

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(100% - 2rem, 54rem);
  margin: 0 auto;
  padding: 1.3rem 0;
  border-bottom: 1px solid #d7d4c8;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
}

.brand {
  color: #141413;
  font-weight: 700;
  text-decoration: none;
}

.brand span { color: #1b365d; }
.source-link { color: #504e49; }

main {
  width: min(100% - 2rem, 48rem);
  margin: 0 auto;
  padding: clamp(3rem, 8vw, 6.5rem) 0 7rem;
}

article { font-size: clamp(1.05rem, 1.4vw, 1.16rem); line-height: 1.72; }

h1, h2, h3, h4, h5, h6 {
  color: #141413;
  line-height: 1.14;
  text-wrap: balance;
}

h1 {
  max-width: 16ch;
  margin: 0 0 2.4rem;
  font-size: clamp(2.65rem, 8vw, 5.4rem);
  font-weight: 500;
  letter-spacing: -0.045em;
}

h2 {
  margin: 4.2rem 0 1.1rem;
  padding-top: 1rem;
  border-top: 1px solid #d7d4c8;
  font-size: clamp(1.75rem, 4vw, 2.45rem);
  font-weight: 500;
  letter-spacing: -0.025em;
}

h3 { margin: 2.8rem 0 0.8rem; font-size: 1.38rem; }
h4, h5, h6 { margin: 2.2rem 0 0.7rem; font-size: 1.08rem; }
p, ul, ol, pre, table, blockquote, .mermaid, .callout { margin: 0 0 1.5rem; }
ul, ol { padding-left: 1.4rem; }
li + li { margin-top: 0.38rem; }
li > p { margin-bottom: 0.35rem; }

code {
  padding: 0.15em 0.35em;
  border-radius: 0.2rem;
  background: #f0eee6;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: 0.83em;
}

pre {
  overflow-x: auto;
  padding: 1.25rem 1.35rem;
  border: 1px solid #d7d4c8;
  border-radius: 0.35rem;
  background: #faf9f5;
  line-height: 1.55;
}

pre code { padding: 0; background: transparent; font-size: 0.82rem; }

blockquote, .callout, .unsupported-component {
  margin-left: 0;
  padding: 1rem 1.2rem;
  border-left: 0.22rem solid #1b365d;
  background: #faf9f5;
  color: #504e49;
}

blockquote[as]::before, .callout::before, .unsupported-component::before {
  display: block;
  margin-bottom: 0.4rem;
  color: #1b365d;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

blockquote[as="note"]::before { content: "Note"; }
blockquote[as="tip"]::before { content: "Tip"; }
blockquote[as="important"]::before { content: "Important"; }
blockquote[as="warning"]::before { content: "Warning"; }
blockquote[as="caution"]::before { content: "Caution"; }
.callout::before { content: attr(data-kind); }
.unsupported-component::before { content: "Component"; }
blockquote > :last-child, .callout > :last-child { margin-bottom: 0; }

table {
  display: block;
  width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.94rem;
}

th, td { padding: 0.7rem 0.85rem; border: 1px solid #d7d4c8; text-align: left; }
th { background: #e8e6dc; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 0.78rem; }
tr:nth-child(even) td { background: rgba(250, 249, 245, 0.7); }
hr { margin: 3.4rem 0; border: 0; border-top: 1px solid #d7d4c8; }
img { display: block; max-width: 100%; height: auto; margin: 2rem auto; }
input[type="checkbox"] { margin-right: 0.45rem; accent-color: #1b365d; }

.mermaid {
  overflow-x: auto;
  padding: 1.35rem;
  border: 1px solid #d7d4c8;
  border-radius: 0.35rem;
  background: #faf9f5;
}

.mermaid svg { display: block; min-width: 32rem; max-width: 100%; height: auto; margin: auto; }
.mermaid-error { border-left: 0.22rem solid #9a3412; }
.empty-document { color: #6b6a64; font-style: italic; }
.revision-note, .render-error {
  margin: 0 0 2rem;
  padding: 0.65rem 0.8rem;
  border-left: 0.18rem solid #1b365d;
  color: #504e49;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: 0.78rem;
}
.render-error { border-left-color: #9a3412; }

@media (max-width: 36rem) {
  .site-header { width: min(100% - 1.25rem, 54rem); }
  main { width: min(100% - 1.25rem, 48rem); padding-top: 2.5rem; }
  h1 { font-size: clamp(2.35rem, 14vw, 3.4rem); }
  .mermaid { margin-inline: -0.2rem; padding: 0.8rem; }
}

@media print {
  body { background: white; }
  .site-header { display: none; }
  main { width: 100%; padding: 0; }
}
`

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

type MarkdownNode = Awaited<ReturnType<typeof parseMarkdown>>["nodes"][number]

function textContent(node: MarkdownNode): string {
  if (typeof node === "string") return node
  if (node[0] === null) return ""
  return node.slice(2).map(child => textContent(child as MarkdownNode)).join("")
}

function documentTitle(document: Awaited<ReturnType<typeof parseMarkdown>>, fallback: string): string {
  if (typeof document.frontmatter.title === "string" && document.frontmatter.title.trim())
    return document.frontmatter.title.trim()

  const heading = document.nodes.find(node => Array.isArray(node) && node[0] === "h1")
  return heading ? textContent(heading).trim() || fallback : fallback
}

function supersedesHref(value: unknown): string | undefined {
  if (typeof value !== "string") return
  if (/^\/i\/[0-9a-f-]+\.(?:md|markdown)$/i.test(value)) return value

  try {
    const url = new URL(value)
    if (["http:", "https:"].includes(url.protocol)) return url.href
  }
  catch {}
  return
}

const renderCallout: NodeHandler = async ([tag, attrs, ...children], { render }) => {
  const kind = typeof attrs.type === "string" ? attrs.type : tag
  return `<aside class="callout" data-kind="${escapeHtml(kind)}">${await render(children)}</aside>`
}

const renderMermaid: NodeHandler = ([, attrs]) => {
  const content = String(attrs.content ?? "")

  try {
    const svg = renderMermaidSVG(content, {
      accent: "#1b365d",
      bg: "#faf9f5",
      border: "#9b998f",
      fg: "#141413",
      font: "Georgia",
      line: "#504e49",
      muted: "#6b6a64",
      surface: "#f0eee6",
    }).replace(/^\s*@import url\([^\n]+\);\s*$/gm, "")
    return `<div class="mermaid">${svg}</div>`
  }
  catch {
    return `<pre class="mermaid-error"><code>${escapeHtml(content)}</code></pre>`
  }
}

export async function renderMarkdownDocument(markdown: string, pathname: string): Promise<string> {
  const fallback = /^\/[iI]\/[0-9a-f-]+\.(?:md|markdown)$/i.test(pathname) ? "Untitled document" : pathname.split("/").at(-1)?.replace(/\.(?:md|markdown)$/i, "") || "Untitled document"
  let title = fallback
  let revision = ""
  let body: string

  try {
    const document = await parseMarkdown(markdown, {
      plugins,
      registerDefaultPlugins: false,
    })
    title = documentTitle(document, fallback)
    const supersedes = supersedesHref(document.frontmatter.supersedes)
    if (supersedes)
      revision = `<p class="revision-note">Revision of <a href="${escapeHtml(supersedes)}">a previous document</a>.</p>`

    const content = await renderHtmlFromDocument(document, {
      components: {
        alert: renderCallout,
        callout: renderCallout,
        info: renderCallout,
        mermaid: renderMermaid,
        note: renderCallout,
        tip: renderCallout,
        warning: renderCallout,
      },
    })
    body = content || '<p class="empty-document">This document is empty.</p>'
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "markdown_render_failure", error: error instanceof Error ? error.message : "Unknown error" }))
    body = `<p class="render-error">Drop could not render this document. Its immutable source is still available above.</p><pre><code>${escapeHtml(markdown)}</code></pre>`
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#f5f4ed">
  <title>${escapeHtml(title)} · Drop</title>
  <style>${DOCUMENT_STYLES}</style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><span>ViteHub</span> Drop</a>
    <a class="source-link" href="${escapeHtml(pathname)}?raw">View source</a>
  </header>
  <main>
    ${revision}<article>${body}</article>
  </main>
</body>
</html>`
}
