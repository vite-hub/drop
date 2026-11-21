import { lookup } from "mrmime"

export type PlanKind = "markdown" | "html" | "image" | "file"

export function kindFromFilename(filename: string): PlanKind {
  const type = lookup(filename) ?? ""
  if (type === "text/markdown" || type === "text/plain") return "markdown"
  if (type === "text/html") return "html"
  if (type.startsWith("image/")) return "image"
  return "file"
}

export function videoType(filename: string): string | undefined {
  const type = lookup(filename)
  return type?.startsWith("video/") ? type : undefined
}

export const isPdf = (filename: string) => lookup(filename) === "application/pdf"

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
