import type { DropComment } from "#shared/types"

/** The sandbox drops render in by default: scripts run, but with an opaque origin, so they can't reach Drop's session. */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"

/**
 * Apps and HTML docs on the content origin keep that origin, so storage and history work. It's another host than
 * Drop's, so they still can't reach Drop's session, and the sandbox still keeps them from navigating Drop's tab.
 */
export const CONTENT_SANDBOX = `${PREVIEW_SANDBOX} allow-same-origin`

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
  const open = comments.filter(comment => !comment.resolved).sort((a, b) => a.n - b.n)
  const lines = open.map(comment => `${target(comment)}${comment.page ? ` (${comment.page})` : ""}\n   ${comment.body.replace(/\n/g, "\n   ")} (${comment.authorName}${comment.version < version ? `, on v${comment.version}` : ""})${comment.replies.map(reply => `\n   ↳ ${reply.authorName}: ${reply.body.replace(/\n/g, "\n     ")}`).join("")}`.replace(/^/, `${comment.n}. `))
  return `## Feedback on "${title}"\n\n${url}\n\n${lines.join("\n") || "No open comments."}\n\nDrop a new version that addresses these.`
}
