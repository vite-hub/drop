import type { DropDetail } from "#shared/types"

// A link to one of the drop's own files, as the source writes it: relative, or absolute on any Drop host.
const FILE_LINK = /(?:https?:\/\/[^\s"'()<>]+)?(\/f\/[0-9a-f-]{36}\.[a-z0-9]{1,16})(?:\?raw)?/gi

/**
 * A Markdown doc or a single HTML page as Markdown, for agents and for "Copy as Markdown". A Markdown doc is its own
 * source; an HTML page goes through mdream. Links to the drop's files become absolute, so the copy works anywhere.
 * Null for kinds that have no one text to give (apps, folders, images, files, sites).
 */
export async function dropMarkdown(drop: DropDetail, origin: string): Promise<string | null> {
  if (drop.content === undefined) return null
  const source = drop.content.replace(FILE_LINK, (_, path: string) => new URL(path, origin).href)
  if (drop.kind === "markdown") return source
  // Only HTML needs mdream, a native module: a Markdown doc never loads it.
  if (drop.kind === "html") return (await import("mdream")).htmlToMarkdown(source, { origin, minimal: true })
  return null
}
