import type { DropComment } from "./types"

type Pointed = Pick<DropComment, "kind" | "selector" | "quote" | "label" | "ox" | "oy" | "ow" | "oh" | "page">

const pct = (n: number) => `${Math.round(n / 10)}%`

const fallback = { text: "text", image: "an image", area: "an element", page: "the whole page" } as const

export function formatElementReference(comment: Pointed, coordinateSpace?: "screenshot" | "viewport") {
  const what = comment.kind === "page" ? fallback.page : (comment.label ?? fallback[comment.kind])
  const lines = [
    comment.kind === "page" || !comment.selector ? `[${what}]` : `[${what} selector: \`${comment.selector}\`]`,
  ]
  if (comment.kind === "image" || comment.kind === "area") {
    const down = coordinateSpace ? `down the ${coordinateSpace}` : "down"
    lines.push(
      comment.ow || comment.oh
        ? `Area: ${pct(comment.ox)}–${pct(comment.ox + comment.ow)} across, ${pct(comment.oy)}–${pct(comment.oy + comment.oh)} ${down}`
        : `Spot: ${pct(comment.ox)} across, ${pct(comment.oy)} ${down}`,
    )
  }
  if (comment.quote) lines.push(`> ${comment.quote}`)
  if (comment.page) lines.push(`${/^https?:\/\//.test(comment.page) ? "URL" : "Page"}: ${comment.page}`)
  return lines.join("\n")
}

export function formatSiteElementReference(comment: Pointed) {
  const reviewScreenshot = comment.page && comment.kind === "image" && comment.selector === "body > img"
  const reviewViewport = comment.page && comment.kind === "area" && comment.selector === (comment.label ?? "body")
  return reviewScreenshot || reviewViewport
    ? formatElementReference(
        { ...comment, selector: comment.label ?? "", label: comment.quote, quote: null },
        reviewScreenshot ? "screenshot" : "viewport",
      )
    : formatElementReference(comment)
}
