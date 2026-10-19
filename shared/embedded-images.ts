// The images a doc shows from this Drop. The doc renders in an opaque-origin sandbox that can't send the reader's
// cookie (and behind an auth proxy can't reach /f/ at all), so the viewer fetches each one and inlines it.

/** A link to one of this Drop's files, absolute or not. Group 1 is its /f/ path. */
export const FILE_LINK = /(?:https?:\/\/[^\s"'()<>]+)?(\/f\/[0-9a-f-]{36}\.[a-z0-9]{1,16})(?:\?raw)?/gi

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i
// Enough for a screenshot-heavy review doc; past it, the rest stay plain links.
const MAX_IMAGES = 60

/**
 * The /f/ paths of the images in `sources` that live on `host`: a doc's own attachments, and screenshots published as
 * drops of their own that it links to. Another Drop's files aren't this reader's to fetch.
 */
export function embeddedImagePaths(sources: string[], host: string, attachments: string[] = []): string[] {
  const paths = new Set(attachments)
  for (const [link, path] of sources.join("\n").matchAll(FILE_LINK)) {
    if (path && IMAGE_FILE.test(path) && (!link.startsWith("http") || new URL(link).host === host)) paths.add(path)
  }
  return [...paths].slice(0, MAX_IMAGES)
}
