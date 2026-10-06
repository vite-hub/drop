import type { DropComment } from "#shared/types"

/** The sandbox every drop renders in: scripts run, but with an opaque origin, so they can't reach Drop's session. */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"

/** Open comments as Markdown, ready to paste back to the agent. */
export function feedbackMarkdown(title: string, url: string, comments: DropComment[]) {
  const open = comments.filter(comment => !comment.resolved).sort((a, b) => a.n - b.n)
  const lines = open.map(comment => `${comment.n}. ${comment.quote ? `> ${comment.quote}` : `Image \`${comment.selector}\` at ${(comment.ox / 10).toFixed(0)}%, ${(comment.oy / 10).toFixed(0)}%`}${comment.page ? ` (${comment.page})` : ""}\n   ${comment.body.replace(/\n/g, "\n   ")} (${comment.authorName})`)
  return `## Feedback on "${title}"\n\n${url}\n\n${lines.join("\n") || "No open comments."}\n\nDrop a new version that addresses these.`
}
