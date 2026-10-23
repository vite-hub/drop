import type { H3Event } from "h3"
import type { NodeHandler } from "@comark/html/render"
import { renderHtmlFromDocument } from "@comark/html"
import { log } from "evlog"
import { createMarkdownParser } from "@comark/html/parse"
import alert from "@comark/html/plugins/alert"
import attributes from "@comark/html/plugins/attributes"
import components from "@comark/html/plugins/components"
import footnotes from "@comark/html/plugins/footnotes"
import frontmatter from "@comark/html/plugins/frontmatter"
import mermaid, { Mermaid } from "@comark/html/plugins/mermaid"
import security from "@comark/html/plugins/security"
import taskList from "@comark/html/plugins/task-list"
import { visitAsync } from "@comark/html/utils"
import annotate, { components as annotations } from "comark-annotate/html"
import badge, { components as badgeComponents } from "comark-badge/html"
import cards, { components as cardsComponents } from "comark-cards/html"
import carousel, { components as carouselComponents } from "comark-carousel/html"
import charts, { components as chartsComponents } from "comark-charts/html"
import chips, { components as chipsComponents } from "comark-chips/html"
import codeBlocks, { components as codeComponents } from "comark-code/html"
import diff, { components as diffComponents } from "comark-diff/html"
import embed, { components as embedComponents } from "comark-embed/html"
import icon, { components as iconComponents } from "comark-icon/html"
import media, { components as mediaComponents } from "comark-media/html"
import steps, { components as stepsComponents } from "comark-steps/html"
import tabs, { components as tabsComponents } from "comark-tabs/html"
import zoom, { components as zoomComponents } from "comark-zoom/html"
import { escapeUTF8 as escapeHtml } from "entities"
import { stringifyTokenStyle } from "shiki/core"
import { CALLOUT_CSS, TYPESET_CSS } from "#shared/typeset"
import { textValue } from "#shared/utils/text"
import { codeLanguage, loadHighlighter } from "#shared/highlighter"
import { cachedMarkdown } from "./markdown-cache"

/**
 * The components Markdown may use, beyond plain HTML. The security plugin also checks an alert's kind (`> [!CAUTION]`
 * is `<blockquote as="caution">`) against this list. screenshot, compare, and annotation are comark-annotate's:
 * annotated screenshots for PR evidence. skills/vitehub-drop/references/markdown.md documents each one for agents.
 */
export const COMPONENT_TAGS =
  "alert annotation callout caution compare important info mermaid note screenshot tip warning".split(" ")
const ALLOWED_TAGS = [
  ..."a blockquote br code del em h1 h2 h3 h4 h5 h6 hr img input li ol p pre s section span strong sup table tbody td th thead tr ul".split(
    " ",
  ),
  ...COMPONENT_TAGS,
  // Every block the comark-plugins below render (chart, tabs, diff, steps, ...); each draws only its own markup.
  ...Object.keys({
    ...badgeComponents,
    ...cardsComponents,
    ...carouselComponents,
    ...chartsComponents,
    ...chipsComponents,
    ...codeComponents,
    ...diffComponents,
    ...embedComponents,
    ...iconComponents,
    ...mediaComponents,
    ...stepsComponents,
    ...tabsComponents,
    ...zoomComponents,
  }),
  // comark-tabs renders each item inside its `tabs` handler, so the item has no handler of its own.
  "tabs-item",
]
const MAX_MERMAID_DIAGRAMS = 4
const MAX_MERMAID_SOURCE_CHARACTERS = 8_000
const MAX_HIGHLIGHTED_CHARACTERS = 200_000

type MarkdownTree = Parameters<typeof visitAsync>[0]

/**
 * Shiki colors for code blocks in a language Drop knows: GitHub light inline, GitHub dark as `--shiki-dark` for the
 * viewer's dark mode. It runs after `security`, and everything it adds comes from Shiki's tokens of the escaped code.
 * Past MAX_HIGHLIGHTED_CHARACTERS the rest stay plain, so a huge dump can't eat the Worker's CPU.
 */
const highlight = () => ({
  name: "highlight",
  async post(state: { tree: MarkdownTree }) {
    let budget = MAX_HIGHLIGHTED_CHARACTERS
    await visitAsync(
      state.tree,
      (node) => Array.isArray(node) && node[0] === "pre",
      async (node) => {
        if (!Array.isArray(node) || node.length !== 3) return
        const [, attrs, code] = node
        if (!Array.isArray(code) || code[0] !== "code" || code.length !== 3) return
        const source = textValue(code[2])
        const language = codeLanguage(textValue(attrs.language))
        if (source === undefined || !language || (budget -= source.length) < 0) return

        const { shiki, lang } = await loadHighlighter(language, ["github-light", "github-dark"])
        const { tokens } = shiki.codeToTokens(source, { lang, themes: { light: "github-light", dark: "github-dark" } })
        const highlighted = new Set(Array.isArray(attrs.highlights) ? attrs.highlights : [])
        const lines = tokens.flatMap((line, index) => [
          ...(index ? ["\n"] : []),
          [
            "span",
            { class: highlighted.has(index + 1) ? "line highlight" : "line" },
            ...line.map((token) => ["span", { style: stringifyTokenStyle(token.htmlStyle ?? {}) }, token.content]),
          ],
        ])
        attrs.class = "shiki"
        // SAFETY: each line is a Comark element, ["span", attributes, ...children], whose children are strings or more spans.
        code.splice(2, 1, ...(lines as typeof code))
      },
    )
  },
})

const plugins = [
  frontmatter(),
  alert(),
  taskList(),
  footnotes(),
  components(),
  // Comark 0.8 moved `{props}` out of components(); without it `:icon{name=...}` has no name.
  attributes(),
  mermaid({ theme: "zinc-light" }),
  // comark-plugins, in the order its docs register them (comark.onmax.me/plugins). comark-code comes after highlight.
  annotate(),
  carousel(),
  charts(),
  // Chips keep their downloaded favicons and avatars in memory: the image's node_modules may be read-only.
  chips({ cache: false }),
  diff(),
  embed(),
  icon(),
  badge(),
  media(),
  cards(),
  steps(),
  tabs(),
  zoom(),
  security({
    // `data` lets comark-icon and comark-chips inline their images; Comark allows it only for data:image/* in src.
    allowedProtocols: ["http", "https", "mailto", "data"],
    allowedTags: ALLOWED_TAGS,
    tagFallback: ([tag, , ...children]) => [
      "aside",
      { class: "unsupported-component" },
      `Unsupported component: ${tag}. `,
      ...children,
    ],
  }),
  highlight(),
  codeBlocks(),
] as const

const parse = createMarkdownParser({ plugins, registerDefaultPlugins: false })

/**
 * comark-annotate 0.2 renamed two props that Drop's pr-evidence skill taught agents before it: a screenshot's `url` is
 * `href`, and `label` is `title` on a screenshot or a compare. Published docs never change, so their old names are
 * read as the new ones, on the block's own line, rather than reported as problems.
 */
const LEGACY_BLOCK = /^(\s*:{2,}(screenshot|compare)\{)(.*)$/gm
const renameLegacyProps = (markdown: string) =>
  markdown.replace(LEGACY_BLOCK, (_, open: string, block: string, props: string) => {
    const legacy = block === "screenshot" ? /(^|\s)(url|label)=/g : /(^|\s)(label)=/g
    return (
      open +
      props.replace(legacy, (_prop, space: string, name: string) => `${space}${name === "url" ? "href" : "title"}=`)
    )
  })

const parseMarkdown = (markdown: string) => parse(renameLegacyProps(markdown))

type MarkdownNode = Awaited<ReturnType<typeof parseMarkdown>>["nodes"][number]

function textContent(node: MarkdownNode): string {
  if (!Array.isArray(node)) return node
  const [tag, , ...children] = node
  return tag === null ? "" : children.map((child) => textContent(child)).join("")
}

function documentTitle(document: Awaited<ReturnType<typeof parseMarkdown>>): string {
  const title = textValue(document.frontmatter.title)?.trim()
  if (title) return title

  const heading = document.nodes.find((node) => Array.isArray(node) && node[0] === "h1")
  return (heading && textContent(heading).trim()) || "Untitled document"
}

function supersedesHref(input: unknown): string | undefined {
  const value = textValue(input)
  if (value === undefined) return
  if (/^\/[fi]\/[0-9a-f-]+\.(?:md|markdown)$/i.test(value)) return value

  try {
    const url = new URL(value)
    if (["http:", "https:"].includes(url.protocol)) return url.href
  } catch {}
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
    return rendered.startsWith('<div class="mermaid">')
      ? rendered.replace(/^\s*@import url\([^\n]+\);\s*$/gm, "")
      : fallback
  }
}

/**
 * The one Markdown renderer: Comark with front matter, alerts, task lists, footnotes, server-rendered Mermaid SVG, and a
 * tag allowlist. The /f/ document pages and the viewer (via /api/drops/:id) both show its output.
 */
/** Problems with a document's annotated screenshots, charts, chips, and other plugin blocks, one readable sentence each. Empty when it has none. */
export async function annotationIssues(markdown: string): Promise<string[]> {
  return (await parseMarkdown(markdown)).meta.issues ?? []
}

async function renderMarkdownBody(markdown: string): Promise<{ title: string; html: string }> {
  try {
    const document = await parseMarkdown(markdown)
    const supersedes = supersedesHref(document.frontmatter.supersedes)
    const revision = supersedes
      ? `<p class="revision-note">Revision of <a href="${escapeHtml(supersedes)}">a previous document</a>.</p>`
      : ""
    const issues = document.meta.issues ?? []
    const problems = issues.length
      ? `<aside class="render-error"><p>This document has ${issues.length === 1 ? "a problem" : `${issues.length} problems`}:</p><ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></aside>`
      : ""
    const content = await renderHtmlFromDocument(document, {
      components: {
        ...annotations,
        ...badgeComponents,
        ...cardsComponents,
        ...carouselComponents,
        ...chartsComponents,
        ...chipsComponents,
        ...codeComponents,
        ...diffComponents,
        ...embedComponents,
        ...iconComponents,
        ...mediaComponents,
        ...stepsComponents,
        ...tabsComponents,
        ...zoomComponents,
        alert: renderCallout,
        callout: renderCallout,
        caution: renderCallout,
        important: renderCallout,
        info: renderCallout,
        mermaid: createMermaidRenderer(),
        note: renderCallout,
        tip: renderCallout,
        warning: renderCallout,
      },
    })
    return {
      title: documentTitle(document),
      html: revision + problems + (content || '<p class="empty-document">This document is empty.</p>'),
    }
  } catch (error) {
    log.error({ action: "markdown_render", error: error instanceof Error ? error.message : "Unknown error" })
    return {
      title: "Untitled document",
      html: `<p class="render-error">Drop could not render this document. Its immutable source is still available below.</p><pre><code>${escapeHtml(markdown)}</code></pre>`,
    }
  }
}

/**
 * Blobs never change once uploaded, so a render is keyed by its blob key and cached for a month in the Worker's
 * KV (Nitro `cache` storage). /f/ pages and the viewer share it; uploads warm it.
 */
export const renderMarkdownCached = (key: string, markdown: () => Promise<string>, event?: H3Event) =>
  cachedMarkdown(key, markdown, renderMarkdownBody, event)

export async function renderMarkdownDocument(
  markdown: () => Promise<string>,
  pathname: string,
  key: string,
  event?: H3Event,
): Promise<string> {
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
