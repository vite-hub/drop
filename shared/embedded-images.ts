export const FILE_LINK = /(?:https?:\/\/[^\s"'()<>]+)?(\/f\/[0-9a-f-]{36}\.[a-z0-9]{1,16})(?:\?raw)?/gi

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i
const MEDIA_FILE = /\.(?:mp4|webm|mov|m4v|mp3|wav|ogg|m4a)$/i
const PDF_FILE = /\.pdf$/i
const MAX_IMAGES = 60
export const MAX_PDFS = 10

function embeddedPaths(file: RegExp, sources: string[], host: string, attachments: string[]): string[] {
  const paths = new Set(attachments)
  for (const [link, path] of sources.join("\n").matchAll(FILE_LINK)) {
    if (path && file.test(path) && (!link.startsWith("http") || new URL(link).host === host)) paths.add(path)
  }
  return [...paths].slice(0, MAX_IMAGES)
}

export const embeddedImagePaths = (sources: string[], host: string, attachments: string[] = []) =>
  embeddedPaths(IMAGE_FILE, sources, host, attachments)

export const embeddedMediaPaths = (sources: string[], host: string, attachments: string[] = []) =>
  embeddedPaths(
    MEDIA_FILE,
    sources,
    host,
    attachments.filter((path) => MEDIA_FILE.test(path)),
  )

const ONE_FILE_LINK = new RegExp(`^${FILE_LINK.source}$`, "i")

export function localPdf(src: string, host: string) {
  const [link, path] = src.match(ONE_FILE_LINK) ?? []
  if (!link || !path || !PDF_FILE.test(path)) return
  return link.startsWith("http") && new URL(link).host !== host ? undefined : path
}

const PDF_BOX = /<figure\b[^>]*?\sdata-drop-src="([^"]*)"/gi

export const embeddedPdfPaths = (html: string, host: string) =>
  [...new Set(Array.from(html.matchAll(PDF_BOX), ([, src = ""]) => localPdf(src, host)))]
    .filter((path) => path !== undefined)
    .slice(0, MAX_PDFS)

export const deferPdfs = (html: string, host: string) =>
  html.replace(PDF_BOX, (tag, src: string) => {
    const path = localPdf(src, host)
    return path ? `${tag} data-drop-file="${path}"` : tag
  })

const PENDING_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

export function deferImages(html: string, paths: string[]) {
  const wanted = new Set(paths)
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2]
    const srcset = tag.match(/\ssrcset\s*=\s*(["'])(.*?)\1/i)?.[2]
    const srcPath = src?.match(ONE_FILE_LINK)?.[1]
    const path =
      srcPath && wanted.has(srcPath)
        ? srcPath
        : [...(srcset ?? "").matchAll(FILE_LINK)]
            .map((match) => match[1])
            .find((candidate): candidate is string => !!candidate && wanted.has(candidate))
    if (!path || !wanted.has(path)) return tag

    let deferred = tag.replace(/\s(?:srcset|sizes)\s*=\s*(["']).*?\1/gi, "")
    const own = src && srcPath === path ? src : path
    if (src) {
      deferred = deferred.replace(
        /\ssrc\s*=\s*(["']).*?\1/i,
        ` src="${PENDING_IMAGE}" data-drop-image="${path}" data-drop-src="${own}"`,
      )
    } else {
      deferred = deferred.replace(
        /<img\b/i,
        `<img src="${PENDING_IMAGE}" data-drop-image="${path}" data-drop-src="${own}"`,
      )
    }
    return deferred
  })
}

export function deferMedia(html: string, paths: string[]) {
  const wanted = new Set(paths)
  return html.replace(/<(?:video|audio)\b[^>]*>/gi, (tag) => {
    const path = tag.match(/\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2]?.match(ONE_FILE_LINK)?.[1]
    if (!path || !wanted.has(path)) return tag
    return tag.replace(/\ssrc\s*=\s*(["']).*?\1/i, ` data-drop-media="${path}"`)
  })
}
