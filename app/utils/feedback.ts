import type { DropComment, DropDetail, SiteReviewItem } from "#shared/types"
import { suggestionLine } from "#shared/suggestion"
import { writtenBy } from "#shared/agents"

/** The sandbox drops render in by default: scripts run, but with an opaque origin, so they can't reach Drop's session. */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"

/**
 * Apps and HTML docs on the content origin keep that origin, so storage and history work. It's another host than
 * Drop's, so they still can't reach Drop's session, and the sandbox still keeps them from navigating Drop's tab.
 */
export const CONTENT_SANDBOX = `${PREVIEW_SANDBOX} allow-same-origin`

/**
 * The sandbox for a srcdoc frame. A Markdown doc may also open the print dialog, for Export as PDF: Drop renders it
 * and escapes its raw HTML, so only Drop's and Comark's scripts could call print() or alert(). HTML docs and apps run
 * their author's scripts, and allow-modals would let those put alert() and prompt() over Drop's own page.
 */
export const previewSandbox = (kind: string) =>
  kind === "markdown" ? `${PREVIEW_SANDBOX} allow-modals` : PREVIEW_SANDBOX

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
const sitePct = (coordinate: number) => `${coordinate / 10}%`

/** What a comment points at: its quote, the page, or an element and where on it. */
function target(comment: DropComment) {
  if (comment.quote) return `> ${comment.quote}`
  if (comment.kind === "page") return "The whole page"
  const what = `${comment.kind === "image" ? "Image" : "Element"} \`${comment.selector}\``
  return comment.ow || comment.oh
    ? `${what}, area ${pct(comment.ox)}–${pct(comment.ox + comment.ow)} across, ${pct(comment.oy)}–${pct(comment.oy + comment.oh)} down`
    : `${what} at ${pct(comment.ox)}, ${pct(comment.oy)}`
}

/** Attachments use absolute addresses so pasted feedback can be read outside Drop. */
const images = (item: Pick<DropComment, "attachments">, url: string, indent = "   ") =>
  item.attachments.length
    ? `\n${indent}Images: ${item.attachments.map((file) => new URL(file.url, url).href).join(" ")}`
    : ""

type Screenshot = Pick<NonNullable<SiteReviewItem["screenshot"]>, "url">
type Screenshots = ReadonlyMap<string, Screenshot | null>

function siteAnchor(comment: DropComment, screenshot: Screenshot | null, url: string) {
  const { label, ox, oy, ow, oh } = comment
  const element = label ? `\n   Element \`${label}\`` : ""
  const box = `\n   Box ${sitePct(ox)}–${sitePct(ox + ow)} across, ${sitePct(oy)}–${sitePct(oy + oh)} down the ${screenshot ? "screenshot" : "viewport"}`
  const image = screenshot ? `\n   Screenshot: ${new URL(screenshot.url, url).href}` : ""
  return `${element}${box}${image}`
}

/** Comments as a numbered Markdown list: what each points at, its words, its replies, and its images. */
const commentList = (comments: DropComment[], url: string, version: number, screenshots?: Screenshots) =>
  comments
    .map((comment) => {
      const anchor =
        screenshots && comment.kind !== "page" ? siteAnchor(comment, screenshots.get(comment.id) ?? null, url) : ""
      const summary = anchor && !comment.quote ? "Site annotation" : target(comment)
      return `${comment.n}. ${summary}${comment.page ? ` (${comment.page})` : ""}${anchor}${suggestionLine(comment.suggestion)}\n   ${(comment.body || (comment.suggestion == null ? "(no words, only the image)" : "(no note)")).replace(/\n/g, "\n   ")} (${writtenBy(comment)}${comment.version < version ? `, on v${comment.version}` : ""})${images(comment, url)}${comment.replies.map((reply) => `\n   ↳ ${writtenBy(reply)}: ${reply.body.replace(/\n/g, "\n     ")}${images(reply, url, "     ")}`).join("")}`
    })
    .join("\n")

/** Open comments as Markdown, ready to paste back to the agent. `version` is the one being viewed. */
export function feedbackMarkdown(title: string, url: string, comments: DropComment[], version: number) {
  const open = comments.filter((comment) => !comment.resolved).sort((a, b) => a.n - b.n)
  return `## Feedback on "${title}"\n\n${url}\n\n${commentList(open, url, version) || "No open comments."}\n\nDrop a new version that addresses these.`
}

type PromptDrop = Pick<DropDetail, "id" | "kind" | "title" | "version" | "isOwner">

function nextStep(drop: PromptDrop, comments: DropComment[]) {
  const numbers = comments.map((comment) => comment.n).join(", ")
  const read = `If you have Drop's MCP server, call read_drop for drop ${drop.id} for the current threads and anchors.`
  const fallback =
    "If you lack access or a tool is unavailable, prepare the proposed changes or answers for me instead."
  if (drop.kind === "site")
    return `${read} Fix the site or answer the question, then use reply with resolve: true only if authorized to resolve the thread and the feedback has been addressed. If you can reply but not resolve, omit resolve. ${fallback}`
  if (!drop.isOwner)
    return `${read} For edits, prepare the proposed changes for me to review. For questions, reply without requesting resolution if you can comment, or give me the answers directly.`
  if (drop.kind === "board")
    return `${read} If the board needs changes, use edit_board. Use reply with resolve: true for each thread you've addressed, describing the change or giving the answer. ${fallback}`
  if (drop.kind === "link")
    return `${read} If the link needs changing, use update_drop with url for its address or description for its note. Use reply with resolve: true for each thread you've addressed, describing the change or giving the answer. ${fallback}`
  if (drop.kind === "folder")
    return `${read} Prepare proposed folder changes for me to review. For questions, use reply if you can comment, or give me the answers directly.`
  const accept =
    drop.kind === "markdown" && comments.some((comment) => comment.suggestion !== null)
      ? " First use accept_suggestion for suggestions that are right as written, one call each; it publishes and resolves that thread. If nothing remains, do not publish again."
      : ""
  return `${read}${accept} Only if edits are still needed, publish the next version from the latest content with previous "${drop.id}" and a note saying what changed. Include in resolves only the still-open comments addressed by that publish from [${numbers}]. Where words are the answer, use reply in the comment's thread instead. ${fallback}`
}

/**
 * A prompt that hands an agent the comments this reader is waiting on (`awaitingAnswer`), with their words, so it can
 * start without Drop, and the tool calls that resolve them where it has Drop's MCP server.
 */
export function promptMarkdown(
  drop: PromptDrop,
  url: string,
  comments: DropComment[],
  screenshots: Screenshots = new Map(),
) {
  const count = comments.length === 1 ? "a comment" : `${comments.length} comments`
  return `I left ${count} on "${drop.title}" in Drop. Resolve ${comments.length === 1 ? "it" : "them"}.\n\n${url}\n\n${commentList(comments, url, drop.version, drop.kind === "site" ? screenshots : undefined)}\n\n${nextStep(drop, comments)}`
}
