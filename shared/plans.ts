import { lookup } from "mrmime";

export type PlanKind = "markdown" | "html" | "image" | "file";
export type Visibility = "private" | "shared";
export type ActorKind = "agent" | "browser";

/** What a file becomes, from its MIME type. Plain text reads as Markdown. */
export function kindFromFilename(filename: string): PlanKind {
  const type = lookup(filename) ?? "";
  if (type === "text/markdown" || type === "text/plain") return "markdown";
  if (type === "text/html") return "html";
  if (type.startsWith("image/")) return "image";
  return "file";
}

/** An HTML doc's <title> or first <h1>, else the filename. (Markdown titles come from Comark's parse.) */
export function titleFromSource(source: string, kind: PlanKind, filename: string): string {
  if (kind === "html") {
    const title = source.match(/<title>([^<]+)<\/title>/i)?.[1] ?? source.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1];
    if (title?.trim()) return title.trim().slice(0, 120);
  }
  return filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120) || "Untitled";
}
