import { lookup } from "mrmime"

export type PlanKind = "markdown" | "html" | "image" | "file"

/** What a file becomes, from its MIME type. Plain text reads as Markdown. */
export function kindFromFilename(filename: string): PlanKind {
  const type = lookup(filename) ?? ""
  if (type === "text/markdown" || type === "text/plain") return "markdown"
  if (type === "text/html") return "html"
  if (type.startsWith("image/")) return "image"
  return "file"
}

/** A file the viewer plays: MP4, WebM, and the rest browsers play in a <video>. It stays a `file` drop. */
export function videoType(filename: string): string | undefined {
  const type = lookup(filename)
  return type?.startsWith("video/") ? type : undefined
}

/**
 * An HTML doc's <title> or first <h1>, else `fallback` (the title of the version it replaces), else the filename.
 * (Markdown titles come from Comark's parse.)
 */
export function titleFromSource(source: string, kind: string, filename: string, fallback?: string): string {
  if (kind === "html") {
    const title = source.match(/<title>([^<]+)<\/title>/i)?.[1] ?? source.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]
    if (title?.trim()) return title.trim().slice(0, 120)
  }
  if (fallback?.trim()) return fallback
  return (
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .slice(0, 120) || "Untitled"
  )
}
