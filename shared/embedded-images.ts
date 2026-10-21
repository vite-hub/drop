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

const ONE_FILE_LINK = new RegExp(`^${FILE_LINK.source}$`, "i")
// A transparent pixel holds the image's place until the viewer sends it.
const PENDING_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

/**
 * `html` with every `<img>` that shows one of `paths` waiting for it: a placeholder for its source and the path on
 * `data-drop-image`. The doc's frame asks the viewer for each one as it nears the screen (DEFERRED_IMAGES_SCRIPT in
 * ./documents), so the text shows at once and images nobody scrolls to are never fetched.
 */
export function deferImages(html: string, paths: string[]) {
  const wanted = new Set(paths)
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(/\ssrc="([^"]*)"/i, (attribute, src: string) => {
      const path = src.match(ONE_FILE_LINK)?.[1]
      return path && wanted.has(path) ? ` src="${PENDING_IMAGE}" data-drop-image="${path}"` : attribute
    }),
  )
}
