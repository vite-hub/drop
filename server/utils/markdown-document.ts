import type { H3Event } from "h3"
import type { NodeHandler } from "@comark/html/render"
import { renderHtmlFromDocument } from "@comark/html"
import { log } from "evlog"
import { createMarkdownParser } from "@comark/html/parse"
import alert from "@comark/html/plugins/alert"
import components from "@comark/html/plugins/components"
import frontmatter from "@comark/html/plugins/frontmatter"
import mermaid, { Mermaid } from "@comark/html/plugins/mermaid"
import security from "@comark/html/plugins/security"
import taskList from "@comark/html/plugins/task-list"
import annotate, { components as annotations } from "comark-annotate/html"
import { escapeUTF8 as escapeHtml } from "entities"
import { CALLOUT_CSS, TYPESET_CSS } from "#shared/typeset"
import { textValue } from "#shared/utils/text"
import { cachedMarkdown } from "./markdown-cache"

// screenshot, compare, and annotation are comark-annotate's: annotated screenshots for PR evidence.
const ALLOWED_TAGS = "a alert annotation blockquote br callout code compare del em h1 h2 h3 h4 h5 h6 hr img info input li mermaid note ol p pre s screenshot span strong table tbody td th thead tip tr ul warning".split(" ")
const MAX_MERMAID_DIAGRAMS = 4
const MAX_MERMAID_SOURCE_CHARACTERS = 8_000

const plugins = [
  frontmatter(),
  alert(),
  taskList(),
  components(),
  mermaid({ theme: "zinc-light" }),
  annotate(),
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

const parseMarkdown = createMarkdownParser({ plugins, registerDefaultPlugins: false })


type MarkdownNode = Awaited<ReturnType<typeof parseMarkdown>>["nodes"][number]

function textContent(node: MarkdownNode): string {
  if (!Array.isArray(node)) return node
  const [tag, , ...children] = node
  return tag === null ? "" : children.map(child => textContent(child)).join("")
}

function documentTitle(document: Awaited<ReturnType<typeof parseMarkdown>>): string {
  const title = textValue(document.frontmatter.title)?.trim()
  if (title) return title

  const heading = document.nodes.find(node => Array.isArray(node) && node[0] === "h1")
  return (heading && textContent(heading).trim()) || "Untitled document"
}

function supersedesHref(input: unknown): string | undefined {
  const value = textValue(input)
  if (value === undefined) return
  if (/^\/[fi]\/[0-9a-f-]+\.(?:md|markdown)$/i.test(value)) return value

  try {
    const url = new URL(value)
    if (["http:", "https:"].includes(url.protocol)) return url.href
  }
  catch {}
}

const renderCallout: NodeHandler = async ([tag, attrs, ...children], { render }) => {
  const kind = textValue(attrs.type) ?? tag
  return `<aside class="callout" data-kind="${escapeHtml(kind)}">${await render(children)}</aside>`
}

function createMermaidRenderer(): NodeHandler {
  let diagrams = 0
  let sourceCharacters = 0

  return (node) => {
    const content = textValue(node[1].content) ?? ""
    const fallback = `<pre class="mermaid-error"><code>${escapeHtml(content)}</code></pre>`

    diagrams += 1
    sourceCharacters += content.length
    if (diagrams > MAX_MERMAID_DIAGRAMS || sourceCharacters > MAX_MERMAID_SOURCE_CHARACTERS) return fallback

    const rendered = Mermaid(node)
    return rendered.startsWith("<div class=\"mermaid\">")
      ? rendered.replace(/^\s*@import url\([^\n]+\);\s*$/gm, "")
      : fallback
  }
}

/**
 * The one Markdown renderer: Comark with front matter, alerts, task lists, server-rendered Mermaid SVG, and a
 * tag allowlist. The /f/ document pages and the viewer (via /api/drops/:id) both show its output.
 */
/** Problems with a document's annotated screenshots, one readable sentence each. Empty when it has none. */
export async function annotationIssues(markdown: string): Promise<string[]> {
  return (await parseMarkdown(markdown)).meta.annotateIssues ?? []
}

async function renderMarkdownBody(markdown: string): Promise<{ title: string; html: string }> {
  try {
    const document = await parseMarkdown(markdown)
    const supersedes = supersedesHref(document.frontmatter.supersedes)
    const revision = supersedes ? `<p class="revision-note">Revision of <a href="${escapeHtml(supersedes)}">a previous document</a>.</p>` : ""
    const issues = document.meta.annotateIssues ?? []
    const problems = issues.length
      ? `<aside class="render-error"><p>This document's annotated screenshots have ${issues.length === 1 ? "a problem" : `${issues.length} problems`}:</p><ul>${issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></aside>`
      : ""
    const content = await renderHtmlFromDocument(document, {
      components: {
        ...annotations,
        alert: renderCallout,
        callout: renderCallout,
        info: renderCallout,
        mermaid: createMermaidRenderer(),
        note: renderCallout,
        tip: renderCallout,
        warning: renderCallout,
      },
    })
    return { title: documentTitle(document), html: revision + problems + (content || "<p class=\"empty-document\">This document is empty.</p>") }
  }
  catch (error) {
    log.error({ action: "markdown_render", error: error instanceof Error ? error.message : "Unknown error" })
    return { title: "Untitled document", html: `<p class="render-error">Drop could not render this document. Its immutable source is still available below.</p><pre><code>${escapeHtml(markdown)}</code></pre>` }
  }
}

/**
 * Blobs never change once uploaded, so a render is keyed by its blob key and cached for a month in the Worker's
 * KV (Nitro `cache` storage). /f/ pages and the viewer share it; uploads warm it.
 */
export const renderMarkdownCached = (key: string, markdown: () => Promise<string>, event?: H3Event) =>
  cachedMarkdown(key, markdown, renderMarkdownBody, event)

export async function renderMarkdownDocument(markdown: () => Promise<string>, pathname: string, key: string, event?: H3Event): Promise<string> {
  const { title, html: body } = await renderMarkdownCached(key, markdown, event)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#ffffff">
  <title>${escapeHtml(title)} · Drop</title>
  <style>${TYPESET_CSS}${CALLOUT_CSS}</style>
</head>
<body>
  <main>
    <article class="typeset typeset-compact">${body}</article>
  </main>
  <footer class="document-footer">
    <a href="https://drop.vitehub.dev">Built with drop.vitehub.dev</a>
    <span aria-hidden="true">·</span>
    <a href="${escapeHtml(pathname)}?raw">Source</a>
    <span aria-hidden="true">·</span>
    <a href="/report?target=${encodeURIComponent(pathname)}">Report</a>
  </footer>
  <script src="/vendor/medium-zoom/medium-zoom.min.js" defer></script>
  <script src="/document-zoom.js" defer></script>
</body>
</html>`
}
