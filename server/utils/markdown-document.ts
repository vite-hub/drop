import { type H3Event, HTTPError } from "h3"
import type { NodeHandler } from "@comark/html/render"
import { renderHtmlFromDocument } from "@comark/html"
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
import { logError } from "./logs"
import { cachedMarkdown } from "./markdown-cache"
import { FAVICON_PATH, faviconUrl, linkText } from "#shared/resources"
import { chipNode } from "comark-chips"
import outline, { scripts as outlineScripts } from "comark-outline/html"
import { scripts as propertiesScripts } from "comark-properties/html"
import { describeTime } from "comark-time"
import type { DropResource } from "#shared/types"

const DROP_LINK = /^(?:(?:https?:\/\/[^/]+)?\/d\/)?([0-9a-hjkmnp-tv-z]{12})(?:[/?#].*)?$/

const dropPlayer = (url: URL) => {
  const link = url.pathname.match(DROP_LINK)?.[1]
  return link ? { provider: "drop", src: `/d/${link}`, label: "Embedded drop", size: "app" as const } : undefined
}

const preset = comarkUi({
  chips: { download: false, favicon: (host) => `${FAVICON_PATH}${host}` },
  diagrams: true,
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
  time: false,
  // Its runtime is one more inline script for the CSP; Drop's documents keep their blocks still until it's adopted.
  motion: false,
  typeset: false,
  zoom: { images: false },
})

export const RENDERER_SCRIPTS = [
  mermaidScript,
  ...scriptsOf(await renderHtmlFromDocument({ nodes: [["zoom-runtime", {}]] }, { components: preset.components })),
  ...propertiesScripts,
  ...outlineScripts,
]

function scriptsOf(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) => script!)
}

export const COMPONENT_TAGS =
  "alert annotation callout caution compare important info note screenshot tip warning".split(" ")
const LEGACY_TAGS = ["drop"]
const ALLOWED_TAGS = [...preset.tags, ...Object.keys(preset.components), ...COMPONENT_TAGS, ...LEGACY_TAGS]

export const renderPlugins = [
  linkify(),
  frontmatter(),
  taskList(),
  components(),
  attributes(),
  ...preset.plugins,
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

const parse = createMarkdownParser({ plugins: renderPlugins, registerDefaultPlugins: false })

const LEGACY_BLOCK = /^(\s*:{2,}(screenshot|compare)\{)(.*)$/gm
const renameLegacyProps = (markdown: string) =>
  markdown.replace(LEGACY_BLOCK, (_, open: string, block: string, props: string) => {
    const legacy = block === "screenshot" ? /(^|\s)(url|label)=/g : /(^|\s)(label)=/g
    return (
      open +
      props.replace(legacy, (_prop, space: string, name: string) => `${space}${name === "url" ? "href" : "title"}=`)
    )
  })

export const parseMarkdown = (markdown: string) => parse(renameLegacyProps(markdown))

const parseForReaders = createMarkdownParser({
  plugins: renderPlugins.map((plugin) => (plugin.name === "comark-outline" ? outline({ rail: true }) : plugin)),
  registerDefaultPlugins: false,
})

type MarkdownNode = Awaited<ReturnType<typeof parseMarkdown>>["nodes"][number]

function textContent(node: MarkdownNode): string {
  if (!Array.isArray(node)) return node
  const [tag, , ...children] = node
  return tag === null ? "" : children.map((child) => textContent(child)).join("")
}

function tableChipCount(node: MarkdownNode): number {
  if (!Array.isArray(node) || node[0] === null) return 0
  const [tag, , ...children] = node
  return tag === "chip" ? 1 : children.reduce((count, child) => count + tableChipCount(child), 0)
}

function markScrollableTables(nodes: MarkdownNode[]): void {
  for (const node of nodes) {
    if (!Array.isArray(node) || node[0] === null) continue
    const [tag, attrs, ...children] = node
    if (tag === "comments" || tag === "comments-render") markScrollableTables(children)
    if (tag !== "div" || !("data-cols" in attrs) || !("data-wide" in attrs) || "data-fold" in attrs) continue
    const [table] = children
    if (!Array.isArray(table) || table[0] !== "table" || table[1].role !== "table") continue

    const totals: { length: number; count: number }[] = []
    const [, , ...parts] = table
    for (const part of parts) {
      if (!Array.isArray(part) || part[0] !== "tbody") continue
      const [, , ...rows] = part
      for (const row of rows) {
        if (!Array.isArray(row) || row[0] !== "tr") continue
        const [, , ...cells] = row
        cells.forEach((cell, index) => {
          const total = (totals[index] ??= { length: 0, count: 0 })
          total.length += textContent(cell).trim().length + 3 * tableChipCount(cell)
          total.count++
        })
      }
    }
    if (totals.length && !totals.some((total) => total.length >= 32 * total.count)) {
      table[1]["data-drop-scroll-table"] = ""
    }
  }
}

function documentTitle(document: Awaited<ReturnType<typeof parseMarkdown>>): string {
  const title = textValue(document.frontmatter.title)?.trim()
  if (title) return title

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

const renderEmbed: NodeHandler = (node, state) => {
  const [, attrs] = node
  const link = attrs.provider === "drop" ? textValue(attrs.src)?.match(DROP_LINK)?.[1] : undefined
  if (link) return dropBox(link, attrs.height, textValue(attrs.label) ?? "Embedded drop")
  return preset.components.embed?.(node, state) ?? ""
}

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

function problemsHtml(issues: string[]) {
  const title = issues.length === 1 ? "This doc has a problem" : `This doc has ${issues.length} problems`
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

const RETRIED_RULE = /\/(?:download-failed|server-unreachable)$/

type DocumentMeta = Awaited<ReturnType<typeof parseMarkdown>>["meta"]

const Issues = v.fallback(v.array(v.string()), [])
const IssueRules = v.fallback(v.record(v.string(), v.string()), {})

function issuesOf(meta: DocumentMeta) {
  const all = v.parse(Issues, meta.issues)
  const rules = v.parse(IssueRules, meta.issueRules)
  return { all, retry: all.some((issue) => RETRIED_RULE.test(rules[issue] ?? "")) }
}

interface MarkdownProblem {
  rule: string
  severity: "error" | "warning"
  line: number
  column?: number
  message: string
  fix: string
}

const DROP_ERROR_RULE = /^comark\/(?:unclosed-block|malformed-attributes|unknown-component|annotate\/.+)$/

const LINT_COMPONENTS = [...ALLOWED_TAGS, ...preset.blocks]

export async function lintMarkdown(markdown: string, event?: H3Event): Promise<MarkdownProblem[]> {
  const found = await lint(renameLegacyProps(markdown), { plugins: renderPlugins, components: LINT_COMPONENTS })
  return found.flatMap(({ rule, severity, line, column, message, fix, cause }) => {
    if (cause !== undefined && !(rule === "comark/invalid-frontmatter" || message.startsWith("Comark could not"))) {
      logError(event, cause, { action: "markdown_lint", rule, message })
      return []
    }
    const error = cause !== undefined || severity === "error" || DROP_ERROR_RULE.test(rule)
    return [{ rule, severity: error ? "error" : "warning", line, ...(column && { column }), message, fix }]
  })
}

export const problemLine = ({ line, column, rule, message, fix }: MarkdownProblem) =>
  `${line}${column ? `:${column}` : ""} ${rule} ${message}${fix ? ` ${fix}` : ""}`

export async function requirePublishableMarkdown(markdown: string, event?: H3Event): Promise<MarkdownProblem[]> {
  const problems = await lintMarkdown(markdown, event)
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

async function renderMarkdownBody(
  markdown: string,
  blobKey: string,
  event?: H3Event,
): Promise<{ title: string; html: string; retry?: true; failed?: true }> {
  try {
    const document = await parseForReaders(renameLegacyProps(markdown))
    markScrollableTables(document.nodes)
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
    logError(event, error, { action: "markdown_render", blobKey })
    return {
      title: "Untitled document",
      html: `<p class="render-error">Drop could not render this document. Its immutable source is still available below.</p><pre><code>${escapeHtml(markdown)}</code></pre>`,
      failed: true,
    }
  }
}

export const renderMarkdownCached = (key: string, markdown: () => Promise<string>, event?: H3Event) =>
  cachedMarkdown(key, markdown, (text) => renderMarkdownBody(text, key, event), event)

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

function timeNode(at: number): PropertyNode {
  const time = describeTime(new Date(at).toISOString(), { timeZone: "UTC", threshold: "none" })!
  const label = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(at)
  const id = `cfm-updated-${at}`
  return [
    "time",
    { class: "ctm", datetime: time.datetime, "data-mode": "absolute", tabindex: "0", "aria-describedby": id },
    label,
    ["span", { class: "ctm-tip", role: "tooltip", id }, ["span", { class: "ctm-pill" }, time.tip]],
  ]
}

const PROPERTIES_BOX = /<dl class="cfm"[^>]*>/
const CHIP_STYLES = /<style data-comark-chips[^>]*>[\s\S]*?<\/style>/
const PROPERTIES_STYLES = /<style data-comark-properties[^>]*>[\s\S]*?<\/style>/

export async function withDocProperties(html: string, doc: { resources: DropResource[]; updatedAt: number }) {
  const open = html.search(PROPERTIES_BOX)
  const close = open === -1 ? -1 : html.indexOf("</dl>", open)
  const box = open === -1 ? "" : html.slice(open, close)
  const links = doc.resources.filter((resource) => !box.includes(`href="${escapeHtml(resource.url)}"`))
  // SAFETY: chipNode builds an element node, [tag, attributes, ...children], as PropertyNode describes.
  const chips = links.map(
    (resource) => chipNode(resource.url, linkText(resource), faviconUrl(resource.url)) as PropertyNode,
  )
  const rows: PropertyNode[] = [
    ...(links.length
      ? [
          [
            "div",
            { "data-key": "links", "data-kind": links.length === 1 ? "link" : "tags" },
            ["dt", {}, links.length === 1 ? "Link" : "Links"],
            ["dd", {}, ...chips],
          ] satisfies PropertyNode,
        ]
      : []),
    ["div", { "data-key": "updated", "data-kind": "date" }, ["dt", {}, "Updated"], ["dd", {}, timeNode(doc.updatedAt)]],
  ]
  const rendered = await renderHtmlFromDocument(
    // SAFETY: the rows are Drop's own nodes, with hrefs resources.ts already checked (https, or http on localhost).
    { nodes: [["properties", {}, ...rows]] } as Parameters<typeof renderHtmlFromDocument>[0],
    { components: preset.components },
  )
  const own = CHIP_STYLES.test(html)
  if (open === -1) return (own ? rendered.replace(CHIP_STYLES, "") : rendered) + html
  const opening = PROPERTIES_BOX.exec(rendered)!
  const start = opening.index + opening[0].length
  const end = rendered.lastIndexOf("</dl>")
  const added = rendered.slice(start, end)
  const dated = box.includes("<time")
  const runtime = dated ? "" : rendered.slice(0, opening.index).replace(PROPERTIES_STYLES, "")
  const after = dated ? "" : rendered.slice(end + "</dl>".length)
  return (
    html.slice(0, open) +
    runtime +
    html.slice(open, close) +
    (own ? added.replace(CHIP_STYLES, "") : added) +
    "</dl>" +
    after +
    html.slice(close + "</dl>".length)
  )
}
