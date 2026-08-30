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

export async function renderMarkdownDocument(markdown: string, pathname: string, styles: string): Promise<string> {
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
    body = `<p class="render-error">Drop could not render this document. Its immutable source is still available below.</p><pre><code>${escapeHtml(markdown)}</code></pre>`
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#ffffff">
  <title>${escapeHtml(title)} · Drop</title>
  <style>${styles}</style>
</head>
<body>
  <main>
    ${revision}<article class="typeset typeset-compact">${body}</article>
  </main>
  <footer class="document-footer">
    <a href="https://drop.vitehub.dev">Built with drop.vitehub.dev</a>
    <span aria-hidden="true">·</span>
    <a href="${escapeHtml(pathname)}?raw">Source</a>
  </footer>
</body>
</html>`
}
