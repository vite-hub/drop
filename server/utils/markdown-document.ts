import type { H3Event } from "h3"
import type { NodeHandler } from "@comark/html/render"
import { renderHtmlFromDocument } from "@comark/html"
import { log } from "evlog"
import { createMarkdownParser } from "@comark/html/parse"
import attributes from "@comark/html/plugins/attributes"
import components from "@comark/html/plugins/components"
import frontmatter from "@comark/html/plugins/frontmatter"
import mermaid, { Mermaid } from "@comark/html/plugins/mermaid"
import security from "@comark/html/plugins/security"
import taskList from "@comark/html/plugins/task-list"
import { visitAsync } from "@comark/html/utils"
import comarkUi from "comark-ui/html"
import { escapeUTF8 as escapeHtml } from "entities"
import * as v from "valibot"
import { stringifyTokenStyle } from "shiki/core"
import { CALLOUT_CSS, TYPESET_CSS } from "#shared/typeset"
import { textValue } from "#shared/utils/text"
import { codeLanguage, loadHighlighter } from "#shared/highlighter"
import { cachedMarkdown } from "./markdown-cache"

/**
 * Every comark-ui package, through its preset, with what a Worker rendering other people's docs needs: include stays
 * off and cast, table, and tests read no files (the preset's defaults), chips leave favicons and avatars for the
 * reader's browser instead of downloading them here, plain images keep Drop's own lightbox, where a click comments, and
 * Mermaid stays Drop's, with its limits.
 */
const preset = comarkUi({ chips: { download: false }, mermaid: false, zoom: { images: false } })

/**
 * The components skills/vitehub-drop/references/markdown.md documents for agents: Drop's own boxes (`::note` and its
 * kinds), Mermaid, and comark-annotate's screenshot, compare, and annotation for PR evidence. Its blocks.md documents
 * every other plugin.
 */
export const COMPONENT_TAGS =
  "alert annotation callout caution compare important info mermaid note screenshot tip warning".split(" ")
const ALLOWED_TAGS = [
  // Markdown's own, and the raw HTML comark-github lets through: GitHub's allowlist.
  ..."a abbr b bdo blockquote br caption cite code dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p picture pre q rp rt ruby s samp section small source span strike strong sub summary sup table tbody td tfoot th thead time tr tt ul var wbr".split(
    " ",
  ),
  // What the plugins draw with that isn't a component of theirs: comark-table's sort buttons, comark-tabs' items, and the
  // parts comark-quiz builds a question, poll, or recall card from.
  "button",
  "tabs-item",
  ..."quiz-after quiz-answer quiz-explain quiz-hint quiz-label quiz-option quiz-options quiz-prompt quiz-rationale".split(
    " ",
  ),
  ...Object.keys(preset.components),
  ...COMPONENT_TAGS,
]
/**
 * Markup a plugin's renderer writes as it is, trusting its parse plugin to have drawn it. An author can write the same
 * component by hand, so these attributes go before the plugins run: comark-diagrams would otherwise print a
 * `::diagram{svg="…"}` from the doc into the page.
 */
const DRAWN_ATTRIBUTES = new Map([
  ["chart", ["svg", "marks"]],
  ["diagram", ["svg"]],
])
const MAX_MERMAID_DIAGRAMS = 4
const MAX_MERMAID_SOURCE_CHARACTERS = 8_000
const MAX_HIGHLIGHTED_CHARACTERS = 200_000

type MarkdownTree = Parameters<typeof visitAsync>[0]

/**
 * Shiki colors for code blocks in a language Drop knows: GitHub light inline, GitHub dark as `--shiki-dark` for the
 * viewer's dark mode. Everything it adds comes from Shiki's tokens of the escaped code, and `security` checks it after.
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

/** Drops the markup in DRAWN_ATTRIBUTES that a doc wrote itself, before the plugins draw theirs. */
const authored = () => ({
  name: "drop-authored",
  async post(state: { tree: MarkdownTree }) {
    await visitAsync(
      state.tree,
      (node) => Array.isArray(node) && DRAWN_ATTRIBUTES.has(textValue(node[0]) ?? ""),
      (node) => {
        if (!Array.isArray(node)) return
        for (const name of DRAWN_ATTRIBUTES.get(textValue(node[0]) ?? "") ?? []) delete node[1][name]
      },
    )
  },
})

const pluginsBeforeCode = preset.plugins.findIndex((plugin) => plugin.name === "comark-code")
const plugins = [
  frontmatter(),
  taskList(),
  components(),
  attributes(),
  mermaid({ theme: "zinc-light" }),
  authored(),
  ...preset.plugins.slice(0, pluginsBeforeCode),
  // Before comark-code, which marks and numbers the lines Shiki drew.
  highlight(),
  ...preset.plugins.slice(pluginsBeforeCode),
  // Last, so it checks what every plugin drew from the doc.
  security({
    allowedProtocols: ["http", "https", "mailto", "data"],
    allowedTags: ALLOWED_TAGS,
    tagFallback: ([tag, , ...children]) => [
      "aside",
      { class: "unsupported-component" },
      `Unsupported component: ${tag}. `,
      ...children,
    ],
  }),
]

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

/** The parse Drop renders with: every plugin, Drop's own, and the tag allowlist. */
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

/** Problems a network failure caused, which the next render may not have: an icon or a Kroki server out of reach. */
const RETRIED_RULE = /\/(?:download-failed|server-unreachable)$/

type DocumentMeta = Awaited<ReturnType<typeof parseMarkdown>>["meta"]

const Issues = v.fallback(v.array(v.string()), [])
const IssueRules = v.fallback(v.record(v.string(), v.string()), {})

/** Each plugin names its problems (`comark/<plugin>/<rule>`); one without a name counts as a block's. */
function issuesOf(meta: DocumentMeta) {
  const all = v.parse(Issues, meta.issues)
  const rules = v.parse(IssueRules, meta.issueRules)
  const annotated = (issue: string) => rules[issue]?.startsWith("comark/annotate/") === true
  return {
    all,
    annotations: all.filter(annotated),
    blocks: all.filter((issue) => !annotated(issue)),
    retry: all.some((issue) => RETRIED_RULE.test(rules[issue] ?? "")),
  }
}

/**
 * A doc's problems, one readable sentence each: its annotated screenshots', which `publish` refuses, and every other
 * block's, which the doc shows. Empty when it has none.
 */
export async function markdownIssues(markdown: string): Promise<{ annotations: string[]; blocks: string[] }> {
  const { annotations, blocks } = issuesOf((await parseMarkdown(markdown)).meta)
  return { annotations, blocks }
}

/**
 * The one Markdown renderer: Comark with front matter, task lists, server-rendered Mermaid SVG, every comark-ui
 * package, and a tag allowlist. The /f/ document pages and the viewer (via /api/drops/:id) both show its output.
 */
async function renderMarkdownBody(markdown: string): Promise<{ title: string; html: string; retry?: true }> {
  try {
    const document = await parseMarkdown(markdown)
    const supersedes = supersedesHref(document.frontmatter.supersedes)
    const revision = supersedes
      ? `<p class="revision-note">Revision of <a href="${escapeHtml(supersedes)}">a previous document</a>.</p>`
      : ""
    const { all: issues, retry } = issuesOf(document.meta)
    const problems = issues.length
      ? `<aside class="render-error"><p>This document has ${issues.length === 1 ? "a problem" : `${issues.length} problems`}:</p><ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></aside>`
      : ""
    const content = await renderHtmlFromDocument(document, {
      components: {
        ...preset.components,
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
      ...(retry && { retry: true as const }),
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
