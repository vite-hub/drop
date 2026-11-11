import { type H3Event, HTTPError } from "h3"
import type { NodeHandler } from "@comark/html/render"
import { renderHtmlFromDocument } from "@comark/html"
import { log } from "evlog"
import { createMarkdownParser } from "@comark/html/parse"
import attributes from "@comark/html/plugins/attributes"
import components from "@comark/html/plugins/components"
import frontmatter from "@comark/html/plugins/frontmatter"
import linkify from "@comark/html/plugins/linkify"
import security from "@comark/html/plugins/security"
import taskList from "@comark/html/plugins/task-list"
import { lint } from "comark-linter"
import comarkUi, { mermaidScript } from "comark-ui/html"
import { escapeUTF8 as escapeHtml } from "entities"
import * as v from "valibot"
import { TYPESET_CSS } from "#shared/typeset"
import { textValue } from "#shared/utils/text"
import { loadHighlighter } from "#shared/highlighter"
import { cachedMarkdown } from "./markdown-cache"
import { isPreviewLink, linkText } from "#shared/resources"
import type { DropResource } from "#shared/types"

/** A drop's link key (shared/links.ts), alone or in its page's address: `/d/<link>/<slug>`. */
const DROP_LINK = /^(?:(?:https?:\/\/[^/]+)?\/d\/)?([0-9a-hjkmnp-tv-z]{12})(?:[/?#].*)?$/

/**
 * `::embed` plays a drop's page (`/d/<link>`) as another drop shown in the doc, on any host: a render is cached for
 * every reader, so it can't know which address a self-hosted Drop's readers use. comark-linter, which runs without this,
 * reads the same link as a card, so an agent's doc lints clean before it's published.
 */
const dropPlayer = (url: URL) => {
  const link = url.pathname.match(DROP_LINK)?.[1]
  return link ? { provider: "drop", src: `/d/${link}`, label: "Embedded drop", size: "app" as const } : undefined
}

/**
 * Every comark-ui package, through its preset, with what a Worker rendering other people's docs needs: include stays
 * off and cast, table, and tests read no files (the preset's defaults), chips leave favicons and avatars for the
 * reader's browser instead of downloading them here, plain images keep Drop's own lightbox, where a click comments,
 * Mermaid draws at most 4 diagrams and 8,000 characters of source a doc, Shiki colors code in the languages Drop
 * loads (GitHub light, and GitHub dark for the viewer's dark mode) up to 200,000 characters a doc, so a huge dump can't
 * eat the Worker's CPU, and Drop supplies the document's typography.
 */
const preset = comarkUi({
  chips: { download: false },
  embed: { player: dropPlayer },
  mermaid: { maxDiagrams: 4, maxSource: 8_000 },
  shiki: {
    highlighter: async (language) => {
      const { shiki, lang } = await loadHighlighter(language, ["github-light", "github-dark"])
      return lang === "text" ? undefined : shiki
    },
    themes: { light: "github-light", dark: "github-dark" },
    maxSource: 200_000,
  },
  // Drop keeps a render for up to 30 days and shares one preset across docs, so relative dates would stay at the
  // words they had on the first read.
  time: false,
  typeset: false,
  zoom: { images: false },
})

/**
 * The inline scripts the renderer writes itself, which the /f/ pages' CSP allows by hash: Mermaid's copy buttons and
 * comark-zoom, which zooms diagrams and annotated screenshots. Scripts in a document's own source stay blocked.
 */
export const RENDERER_SCRIPTS = [
  mermaidScript,
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
 * kinds), and comark-annotate's screenshot, compare, and annotation for PR evidence. Its blocks.md documents every
 * other plugin.
 */
export const COMPONENT_TAGS =
  "alert annotation callout caution compare important info note screenshot tip warning".split(" ")
/** `::drop{link=…}`, which showed another drop in a doc before `::embed` did. Published docs never change. */
const LEGACY_TAGS = ["drop"]
const ALLOWED_TAGS = [...preset.tags, ...Object.keys(preset.components), ...COMPONENT_TAGS, ...LEGACY_TAGS]

const plugins = [
  // A bare URL is a link, as on GitHub. Comark 0.9 moved it into the defaults Drop leaves out, so it's listed here.
  linkify(),
  frontmatter(),
  taskList(),
  components(),
  attributes(),
  ...preset.plugins,
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

const EMBED_HEIGHT = { min: 120, max: 1600, default: 480 }

/**
 * Another drop, shown inside the doc. The render is cached for every reader, so it only holds the link: the viewer
 * fetches the drop as the reader, and only an HTML drop they may open fills the box (EMBEDS_SCRIPT in
 * #shared/documents), in a sandbox of its own. On the /f/ page, which runs no scripts, the box stays a link.
 */
function dropBox(link: string, height: unknown, title: string) {
  const pixels = Math.round(Number(height ?? Number.NaN))
  const clamped = Number.isFinite(pixels)
    ? Math.min(EMBED_HEIGHT.max, Math.max(EMBED_HEIGHT.min, pixels))
    : EMBED_HEIGHT.default
  return (
    `<figure class="drop-embed" data-drop-embed="${link}" data-title="${escapeHtml(title)}" style="--drop-embed-height: ${clamped}px">` +
    `<a class="drop-embed-link" href="/d/${link}">${escapeHtml(title)}</a></figure>`
  )
}

/** `::embed` with a drop's page draws its box, and comark-embed draws every other link. */
const renderEmbed: NodeHandler = (node, state) => {
  const [, attrs] = node
  const link = attrs.provider === "drop" ? textValue(attrs.src)?.match(DROP_LINK)?.[1] : undefined
  if (link) return dropBox(link, attrs.height, textValue(attrs.label) ?? "Embedded drop")
  return preset.components.embed?.(node, state) ?? ""
}

/** `::drop{link=…}`, in docs published before `::embed` showed drops. */
const renderDropEmbed: NodeHandler = ([, attrs]) => {
  const link = textValue(attrs.link)?.trim().match(DROP_LINK)?.[1]
  if (!link)
    return `<aside class="callout" data-kind="warning"><p><code>::drop</code> needs the link of the drop to show: <code>::drop{link=k7f2q9m4x8wd}</code>.</p></aside>`
  return dropBox(link, attrs.height, textValue(attrs.title)?.trim() || "Embedded drop")
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

interface MarkdownProblem {
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
 * What a doc can't publish with: every rule comark-linter marks as an error (invalid front matter, script URLs, a quiz
 * without an answer), and Drop's stricter extras, which the linter only warns about: a block that never closes, broken
 * `{…}` attributes, a component Drop doesn't render, and every problem of an annotated screenshot, whose marks would
 * land in the wrong place.
 */
const DROP_ERROR_RULE = /^comark\/(?:unclosed-block|malformed-attributes|unknown-component|annotate\/.+)$/

/** The components a doc may write: the allowlist, and the blocks comark-ui's plugins turn into other components. */
const LINT_COMPONENTS = [...ALLOWED_TAGS, ...preset.blocks]

/**
 * comark-linter over the parse Drop renders with: the same plugins, the components the allowlist keeps, and the
 * legacy props read as their new names. Every problem has its line and how to fix it. Links to other files and
 * external URLs aren't checked: a published doc has no folder around it. The checks read the source, so they can say
 * an annotation's box is outside its image, not that it points at the button it means.
 */
export async function lintMarkdown(markdown: string): Promise<MarkdownProblem[]> {
  const found = await lint(renameLegacyProps(markdown), { plugins, components: LINT_COMPONENTS })
  return found.flatMap(({ rule, severity, line, column, message, fix, cause }) => {
    // A rule that threw is comark-linter's bug, not the doc's, and its message says so; Comark failing to parse the doc
    // is the doc's.
    if (cause !== undefined && !(rule === "comark/invalid-frontmatter" || message.startsWith("Comark could not"))) {
      log.error({ action: "markdown_lint", rule, error: message })
      return []
    }
    const error = cause !== undefined || severity === "error" || DROP_ERROR_RULE.test(rule)
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
 * The one Markdown renderer: Comark with front matter, task lists, every comark-ui package, and a tag allowlist. The
 * /f/ document pages and the viewer (via /api/drops/:id) both show its output.
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
        embed: renderEmbed,
        important: renderCallout,
        info: renderCallout,
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
<html lang="en" class="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#ffffff">
  <title>${escapeHtml(title)} · Drop</title>
  <style>${TYPESET_CSS}</style>
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

type PropertyNode = [string, Record<string, string>, ...(PropertyNode | string)[]]

// comark-properties' box opens with `<dl class="cfm"`, then whatever attributes its release adds, such as 0.10's
// data-comark-frame.
const PROPERTIES_BOX = /<dl class="cfm"[^>]*>/

/**
 * A doc's properties box with what Drop knows about it beside what its front matter says: the pages it links to (its
 * pull request, its issue) and when this version was published. They read as more front matter rows, at the top of
 * the doc, where a reader looks for what a doc is about; preview deploys stay in the header, as something to open. A
 * doc without front matter gets the box. A link its front matter already shows isn't repeated.
 *
 * Added to the cached render on each read, since a doc's links change without a new version.
 */
export async function withDocProperties(html: string, doc: { resources: DropResource[]; updatedAt: number }) {
  const open = html.search(PROPERTIES_BOX)
  const close = open === -1 ? -1 : html.indexOf("</dl>", open)
  const box = open === -1 ? "" : html.slice(open, close)
  const links = doc.resources.filter(
    (resource) => !isPreviewLink(resource) && !box.includes(`href="${escapeHtml(resource.url)}"`),
  )
  const anchors = links.map((resource): PropertyNode => ["a", { href: resource.url }, linkText(resource)])
  const updated = new Date(doc.updatedAt)
  const shown = updated.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
  const rows: PropertyNode[] = [
    ...(links.length
      ? [
          [
            "div",
            { "data-key": "links", "data-kind": links.length === 1 ? "link" : "tags" },
            ["dt", {}, links.length === 1 ? "Link" : "Links"],
            [
              "dd",
              {},
              ...(links.length === 1 ? anchors : anchors.map((a): PropertyNode => ["span", { class: "cfm-tag" }, a])),
            ],
          ] satisfies PropertyNode,
        ]
      : []),
    [
      "div",
      { "data-key": "updated", "data-kind": "date" },
      ["dt", {}, "Updated"],
      ["dd", {}, ["time", { datetime: updated.toISOString().slice(0, 10) }, shown]],
    ],
  ]
  const rendered = await renderHtmlFromDocument(
    // SAFETY: the rows are Drop's own nodes, with hrefs resources.ts already checked (https, or http on localhost).
    { nodes: [["properties", {}, ...rows]] } as Parameters<typeof renderHtmlFromDocument>[0],
    { components: preset.components },
  )
  if (open === -1) return rendered + html
  // The page already has the box's styles and date script: only its rows go in, after the front matter's.
  const opening = PROPERTIES_BOX.exec(rendered)!
  const start = opening.index + opening[0].length
  return html.slice(0, close) + rendered.slice(start, rendered.lastIndexOf("</dl>")) + html.slice(close)
}
