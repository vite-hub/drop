import { type H3Event, HTTPError } from "h3"
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
import { lint } from "comark-linter"
import comarkUi from "comark-ui/html"
import { escapeUTF8 as escapeHtml } from "entities"
import * as v from "valibot"
import { stringifyTokenStyle } from "shiki/core"
import { CALLOUT_CSS, TYPESET_CSS } from "#shared/typeset"
import { textValue } from "#shared/utils/text"
import { codeLanguage, loadHighlighter } from "#shared/highlighter"
import { cachedMarkdown } from "./markdown-cache"
import { MERMAID_COPY_CSS, MERMAID_COPY_SCRIPT } from "#shared/mermaid-copy"

/**
 * Every comark-ui package, through its preset, with what a Worker rendering other people's docs needs: include stays
 * off and cast, table, and tests read no files (the preset's defaults), chips leave favicons and avatars for the
 * reader's browser instead of downloading them here, plain images keep Drop's own lightbox, where a click comments, and
 * Mermaid stays Drop's, with its limits, and Drop supplies the document's typography.
 */
const preset = comarkUi({ chips: { download: false }, mermaid: false, typeset: false, zoom: { images: false } })
// Writes comark-zoom's script once per render, using the renderer's context to track it.
const zoomRuntime = (state: Parameters<NodeHandler>[1]) =>
  preset.components["zoom-runtime"]!(["zoom-runtime", {}], state)

/**
 * The inline scripts the renderer writes itself, which the /f/ pages' CSP allows by hash: Mermaid's copy buttons and
 * comark-zoom, which zooms diagrams and annotated screenshots. Scripts in a document's own source stay blocked.
 */
export const RENDERER_SCRIPTS = [
  MERMAID_COPY_SCRIPT,
  (await renderHtmlFromDocument({ nodes: [["zoom-runtime", {}]] }, { components: preset.components })).match(
    /<script>([\s\S]*)<\/script>/,
  )![1]!,
  // comark-properties rewrites a frontmatter date in the reader's locale.
  (
    await renderHtmlFromDocument(
      {
        nodes: [
          [
            "properties",
            {},
            ["div", {}, ["dt", {}, "Date"], ["dd", {}, ["time", { datetime: "2026-10-23" }, "Oct 23, 2026"]]],
          ],
        ],
      },
      { components: preset.components },
    )
  ).match(/<script>([\s\S]*)<\/script>/)![1]!,
]

/**
 * The components skills/vitehub-drop/references/markdown.md documents for agents: Drop's own boxes (`::note` and its
 * kinds), `::drop` (another drop shown in the doc), Mermaid, and comark-annotate's screenshot, compare, and annotation
 * for PR evidence. Its blocks.md documents every other plugin.
 */
export const COMPONENT_TAGS =
  "alert annotation callout caution compare drop important info mermaid note screenshot tip warning".split(" ")
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
export const parseMarkdown = (markdown: string) => parse(renameLegacyProps(markdown))

type MarkdownNode = Awaited<ReturnType<typeof parseMarkdown>>["nodes"][number]

function textContent(node: MarkdownNode): string {
  if (!Array.isArray(node)) return node
  const [tag, , ...children] = node
  return tag === null ? "" : children.map((child) => textContent(child)).join("")
}

function documentTitle(document: Awaited<ReturnType<typeof parseMarkdown>>): string {
  const title = textValue(document.frontmatter.title)?.trim()
  if (title) return title

  // The comments plugin wraps the whole document; headings inside other blocks still aren't document titles.
  const nodes = document.nodes.flatMap((node) => {
    if (!Array.isArray(node) || node[0] !== "comments") return [node]
    const [, , ...children] = node
    return children
  })
  const heading = nodes.find((node) => Array.isArray(node) && node[0] === "h1")
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
  let hasCopyRuntime = false

  return async (node, state) => {
    const content = textValue(node[1].content) ?? ""
    const fallback = `<pre class="mermaid-error"><code>${escapeHtml(content)}</code></pre>`

    diagrams += 1
    sourceCharacters += content.length
    if (diagrams > MAX_MERMAID_DIAGRAMS || sourceCharacters > MAX_MERMAID_SOURCE_CHARACTERS) return fallback

    const rendered = Mermaid(node)
    if (!rendered.startsWith('<div class="mermaid">')) return fallback
    const runtime = hasCopyRuntime ? "" : `<style>${MERMAID_COPY_CSS}</style><script>${MERMAID_COPY_SCRIPT}</script>`
    hasCopyRuntime = true
    // The diagram's own width lets a wide one spread past the text column (document-shell.css), and a click zooms it.
    const width = Number(rendered.match(/<svg[^>]* width="([\d.]+)"/)?.[1]) || 0
    return (
      `<figure class="drop-mermaid" data-source="${escapeHtml(content)}" style="--mermaid-width: ${Math.ceil(width)}px">` +
      rendered
        .replace('<div class="mermaid">', '<div class="mermaid" data-zoom tabindex="0">')
        .replace(/^\s*@import url\([^\n]+\);\s*$/gm, "") +
      `</figure>${runtime}${await zoomRuntime(state)}`
    )
  }
}

/** A drop's link key (shared/links.ts), alone or in its page's address: `/d/<link>/<slug>`. */
const EMBED_LINK = /^(?:(?:https?:\/\/[^/]+)?\/d\/)?([0-9a-hjkmnp-tv-z]{12})(?:[/?#].*)?$/
const EMBED_HEIGHT = { min: 120, max: 1600, default: 480 }

/**
 * `::drop{link=…}`: another drop, shown inside the doc. The render is cached for every reader, so it only holds the
 * link: the viewer fetches the drop as the reader, and only an HTML drop they may open fills the box (EMBEDS_SCRIPT in
 * #shared/documents), in a sandbox of its own. On the /f/ page, which runs no scripts, the box stays a link.
 */
const renderDropEmbed: NodeHandler = ([, attrs]) => {
  const link = textValue(attrs.link)?.trim().match(EMBED_LINK)?.[1]
  if (!link)
    return `<aside class="callout" data-kind="warning"><p><code>::drop</code> needs the link of the drop to show: <code>::drop{link=k7f2q9m4x8wd}</code>.</p></aside>`
  const height = Math.round(Number(attrs.height ?? Number.NaN))
  const clamped = Number.isFinite(height)
    ? Math.min(EMBED_HEIGHT.max, Math.max(EMBED_HEIGHT.min, height))
    : EMBED_HEIGHT.default
  const title = textValue(attrs.title)?.trim() || "Embedded drop"
  return (
    `<figure class="drop-embed" data-drop-embed="${link}" data-title="${escapeHtml(title)}" style="--drop-embed-height: ${clamped}px">` +
    `<a class="drop-embed-link" href="/d/${link}">${escapeHtml(title)}</a></figure>`
  )
}

const PROBLEM_ICON =
  '<svg aria-hidden="true" class="render-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
const FOLD_ICON =
  '<svg aria-hidden="true" class="render-error-fold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'

/**
 * The box above a doc that lists its problems, open so its author sees them, foldable so a reader can put it away.
 * Plugins quote Markdown in backticks (`::question`), which reads as code here.
 */
function problemsHtml(issues: string[]) {
  const title = issues.length === 1 ? "This doc has a problem" : `This doc has ${issues.length} problems`
  // "`::question` 2 has no id" counts blocks of a kind; "#2" says it's an ordinal rather than part of the sentence.
  const items = issues.map(
    (issue) =>
      `<li>${escapeHtml(issue)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/^(<code>::[\w-]+<\/code>) (\d+) /, "$1 #$2 ")}</li>`,
  )
  return (
    `<details class="render-error" open><summary>${PROBLEM_ICON}<span>${title}</span>${FOLD_ICON}</summary>` +
    `<p class="render-error-hint">Fix ${issues.length === 1 ? "it" : "them"} in the Markdown and publish again. Readers see this box until then.</p>` +
    `<ul>${items.join("")}</ul></details>`
  )
}

/** Problems a network failure caused, which the next render may not have: an icon or a Kroki server out of reach. */
const RETRIED_RULE = /\/(?:download-failed|server-unreachable)$/

type DocumentMeta = Awaited<ReturnType<typeof parseMarkdown>>["meta"]

const Issues = v.fallback(v.array(v.string()), [])
const IssueRules = v.fallback(v.record(v.string(), v.string()), {})

/** The problems the plugins report, each named by its rule (`comark/<plugin>/<rule>`), for the box above the doc. */
function issuesOf(meta: DocumentMeta) {
  const all = v.parse(Issues, meta.issues)
  const rules = v.parse(IssueRules, meta.issueRules)
  return { all, retry: all.some((issue) => RETRIED_RULE.test(rules[issue] ?? "")) }
}

export interface MarkdownProblem {
  rule: string
  /** An error stops the doc from publishing; a warning publishes with it. */
  severity: "error" | "warning"
  /** 1-based, counting the front matter. */
  line: number
  column?: number
  message: string
  fix: string
}

/**
 * What a doc can't publish with: a block that never closes, broken `{…}` attributes, a component Drop doesn't render,
 * every problem of an annotated screenshot, whose marks would land in the wrong place, and the rules comark-linter's
 * catalog marks as errors (invalid front matter, script URLs, a quiz without an answer). Its index doesn't export
 * severities, so they're listed here.
 */
const ERROR_RULE =
  /^comark\/(?:unclosed-block|malformed-attributes|unknown-component|invalid-frontmatter|unsafe-url|annotate\/.+|cards\/unsafe-link|[a-z]+\/path-outside-root|quiz\/(?:no-options|no-correct-option|correct-in-poll|missing-answer|duplicate-id|swallowed-slot)|comments\/(?:duplicate-id|unknown-reply))$/

export const blocksPublishing = (rule: string) => ERROR_RULE.test(rule)

/**
 * The components a doc may write: the allowlist, and the blocks comark-ui's plugins turn into other components before
 * the allowlist sees them (comark-linter's own list for comark-ui, which it uses when it loads the preset itself).
 */
const LINT_COMPONENTS = [
  ...ALLOWED_TAGS,
  ..."accordion-item code-group collapsible details ref stats table tabs-item".split(" "),
]

/**
 * comark-linter over the parse Drop renders with: the same plugins, the components the allowlist keeps, and the
 * legacy props read as their new names. Every problem has its line and how to fix it. Links to other files and
 * external URLs aren't checked: a published doc has no folder around it. The checks read the source, so they can say
 * an annotation's box is outside its image, not that it points at the button it means.
 */
export async function lintMarkdown(markdown: string): Promise<MarkdownProblem[]> {
  const found = await lint(renameLegacyProps(markdown), { plugins, components: LINT_COMPONENTS })
  return found.flatMap(({ rule, line, column, message, fix, cause }) => {
    // A rule that threw is comark-linter's bug, not the doc's, and its message says so; Comark failing to parse the doc
    // is the doc's.
    if (cause !== undefined && !(rule === "comark/invalid-frontmatter" || message.startsWith("Comark could not"))) {
      log.error({ action: "markdown_lint", rule, error: message })
      return []
    }
    const error = cause !== undefined || blocksPublishing(rule)
    return [{ rule, severity: error ? "error" : "warning", line, ...(column && { column }), message, fix }]
  })
}

/** A problem as lint-comark prints it: `line:column rule message fix`. */
export const problemLine = ({ line, column, rule, message, fix }: MarkdownProblem) =>
  `${line}${column ? `:${column}` : ""} ${rule} ${message}${fix ? ` ${fix}` : ""}`

/**
 * Lints a Markdown doc before it's stored: one with an error is refused with all its problems, as `message`, and as
 * `data.problems` for clients. Returns the warnings it publishes with.
 */
export async function requirePublishableMarkdown(markdown: string): Promise<MarkdownProblem[]> {
  const problems = await lintMarkdown(markdown)
  const errors = problems.filter((problem) => problem.severity === "error")
  if (!errors.length) return problems
  const [first] = errors
  throw new HTTPError({
    status: 400,
    statusText:
      errors.length === 1
        ? `Line ${first!.line}: ${first!.message}`
        : `This doc has ${errors.length} errors. Line ${first!.line}: ${first!.message}`,
    message: `Drop didn't publish this doc. Fix ${errors.length === 1 ? "this error" : "these errors"} and publish again:\n${errors.map((error) => `- ${problemLine(error)}`).join("\n")}`,
    data: { problems },
  })
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
    const problems = issues.length ? problemsHtml(issues) : ""
    const content = await renderHtmlFromDocument(document, {
      components: {
        ...preset.components,
        alert: renderCallout,
        callout: renderCallout,
        caution: renderCallout,
        drop: renderDropEmbed,
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
