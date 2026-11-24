import type * as Pdfjs from "pdfjs-dist"
import type { PDFDocumentProxy } from "pdfjs-dist"
import type { EmbedLink } from "#shared/frame-messages"

export const PDF_WASM_URL = "/vendor/pdfjs/wasm/"
// doctor-disable-next-line nuxt/ssr/no-module-scope-request-state -- pdf.js in the browser only, not a request's data
let library: Promise<typeof Pdfjs> | undefined
export function pdfjs() {
  library ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    },
  )
  return library
}

export async function openPdf(src: string): Promise<PDFDocumentProxy> {
  const lib = await pdfjs()
  return lib.getDocument({ url: src, wasmUrl: PDF_WASM_URL }).promise
}

export async function drawPage(
  pdf: PDFDocumentProxy,
  n: number,
  size: { width: number } | { longest: number },
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const scale =
    "width" in size ? size.width / base.width : Math.min(4, size.longest / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvas, viewport }).promise
  return canvas
}

export async function renderPage(pdf: PDFDocumentProxy, n: number, { width = 1240 } = {}) {
  const canvas = await drawPage(pdf, n, { width })
  const page = { src: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height }
  canvas.width = canvas.height = 0
  return page
}

const OPENS = /^(?:https?:|mailto:)/i
const per = (value: number, of: number) => Math.round((value / of) * 1000)

export async function pageLinks(pdf: PDFDocumentProxy, n: number): Promise<EmbedLink[]> {
  const page = await pdf.getPage(n)
  const viewport = page.getViewport({ scale: 1 })
  // SAFETY: pdf.js types annotations as `any`; a Link annotation carries its `rect` in PDF points and, for a URI action,
  // the `url` pdf.js found safe to open.
  const annotations = (await page.getAnnotations({ intent: "display" })) as {
    subtype?: string
    url?: string
    rect?: [number, number, number, number]
  }[]
  // SAFETY: convertToViewportPoint returns the point as [x, y].
  const point = (x: number, y: number) => viewport.convertToViewportPoint(x, y) as [number, number]
  return annotations.flatMap(({ subtype, url, rect }) => {
    if (subtype !== "Link" || !url || !OPENS.test(url) || rect?.length !== 4) return []
    const [x1, y1] = point(rect[0], rect[1])
    const [x2, y2] = point(rect[2], rect[3])
    return [
      {
        x: per(Math.min(x1, x2), viewport.width),
        y: per(Math.min(y1, y2), viewport.height),
        w: per(Math.abs(x2 - x1), viewport.width),
        h: per(Math.abs(y2 - y1), viewport.height),
        href: url,
      },
    ]
  })
}
