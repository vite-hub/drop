import type { DropComment } from "#shared/types"

/** The sandbox drops render in by default: scripts run, but with an opaque origin, so they can't reach Drop's session. */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"

/**
 * Apps and HTML docs on the content origin keep that origin, so storage and history work. It's another host than
 * Drop's, so they still can't reach Drop's session, and the sandbox still keeps them from navigating Drop's tab.
 */
export const CONTENT_SANDBOX = `${PREVIEW_SANDBOX} allow-same-origin`

/**
 * What a frame may do beyond its sandbox. Only Markdown docs may write to the clipboard, so comark-annotate's Copy
 * button works: Drop renders them itself, escaping raw HTML, so their only scripts are Drop's and Comark's. HTML docs
 * and apps run whatever their author wrote, and writing to a reader's clipboard is how paste-jacking works. Markdown
 * docs also go full screen, for comark-media's video button.
 */
export const frameAllow = (kind: string) =>
  kind === "markdown" ? "clipboard-write; fullscreen" : kind === "app" || kind === "html" ? PRESENT_ALLOW : undefined

/**
 * What apps and HTML docs get instead, so a deck presents as on its own host (Slidev's fullscreen button, its Screen
 * Mirror, a screen that stays on). The browser announces fullscreen and asks before anyone's screen is captured.
 */
const PRESENT_ALLOW = "fullscreen; display-capture; screen-wake-lock"

const pct = (n: number) => `${(n / 10).toFixed(0)}%`

/** What a comment points at: its quote, the page, or an element and where on it. */
function target(comment: DropComment) {
  if (comment.quote) return `> ${comment.quote}`
  if (comment.kind === "page") return "The whole page"
  const what = `${comment.kind === "image" ? "Image" : "Element"} \`${comment.selector}\``
  return comment.ow || comment.oh
    ? `${what}, area ${pct(comment.ox)}–${pct(comment.ox + comment.ow)} across, ${pct(comment.oy)}–${pct(comment.oy + comment.oh)} down`
    : `${what} at ${pct(comment.ox)}, ${pct(comment.oy)}`
}

/** Open comments as Markdown, ready to paste back to the agent. `version` is the one being viewed. */
export function feedbackMarkdown(title: string, url: string, comments: DropComment[], version: number) {
  const open = comments.filter((comment) => !comment.resolved).sort((a, b) => a.n - b.n)
  const lines = open.map((comment) =>
    `${target(comment)}${comment.page ? ` (${comment.page})` : ""}\n   ${(comment.body || "(no words, only the image)").replace(/\n/g, "\n   ")} (${comment.authorName}${comment.version < version ? `, on v${comment.version}` : ""})${comment.replies.map((reply) => `\n   ↳ ${reply.authorName}: ${reply.body.replace(/\n/g, "\n     ")}`).join("")}`.replace(
      /^/,
      `${comment.n}. `,
    ),
  )
  return `## Feedback on "${title}"\n\n${url}\n\n${lines.join("\n") || "No open comments."}\n\nDrop a new version that addresses these.`
}
