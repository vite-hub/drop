import type { PDFDocumentProxy } from "pdfjs-dist"
import { EMBED_PAGES, type EmbedData, type EmbedMessage, type EmbedPin } from "#shared/frame-messages"
import { embedDocument } from "#shared/plan-runtime"
import { isPdf, videoType } from "#shared/plans"
import type { DropComment, DropDetail } from "#shared/types"

const UNREACHABLE = "This drop is private, expired, or deleted, so it can't show here."
const OPEN_PDFS = 4

const readBlob = (url: string) => $fetch<Blob>(url, { responseType: "blob" })
const close = (pdf: PDFDocumentProxy) => pdf.loadingTask.destroy()

export function useDocEmbeds(drop: Ref<DropDetail>, attachedPdfs: Ref<string[]>, dark: Ref<boolean>) {
  const boxes = computed(() => {
    const titles = new Map<string, string>()
    if (drop.value.kind !== "markdown") return titles
    const template = globalThis.document?.createElement("template")
    if (!template) return titles
    template.innerHTML = drop.value.html ?? ""
    for (const box of template.content.querySelectorAll("figure.drop-embed")) {
      const link = box.getAttribute("data-drop-embed") ?? box.getAttribute("data-drop-file")
      if (link && (box.hasAttribute("data-drop-embed") || attachedPdfs.value.includes(link)))
        titles.set(link, box.getAttribute("data-title") || "PDF")
    }
    return titles
  })

  const pdfs = new Map<string, PDFDocumentProxy>()
  let queue: Promise<unknown> = Promise.resolve()
  function withPdf<T>(link: string, src: string, use: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
    const turn = queue.then(async () => {
      let pdf = pdfs.get(link)
      pdfs.delete(link)
      pdf ??= await openPdf(src)
      pdfs.set(link, pdf)
      for (const [old, stale] of pdfs) {
        if (pdfs.size <= OPEN_PDFS) break
        pdfs.delete(old)
        void close(stale)
      }
      return use(pdf)
    })
    queue = turn.catch(() => {})
    return turn
  }
  const sources = new Map<string, string>()
  const answers = new Map<string, Promise<EmbedData>>()
  const threads = new Map<string, Promise<DropComment[]>>()
  const drawn = new Set<string>()
  function forget() {
    drawn.clear()
    answers.clear()
    sources.clear()
    threads.clear()
    queue = queue.then(() => {
      const open = [...pdfs.values()]
      pdfs.clear()
      return Promise.allSettled(open.map(close))
    })
  }
  watch(() => drop.value.id, forget)
  onScopeDispose(forget)

  function pdfData(link: string, src: string, title: string, href: string): Promise<EmbedData> {
    sources.set(link, src)
    return withPdf(link, src, async (pdf) => ({ kind: "pdf", pages: pdf.numPages, title, href }))
  }
  async function read(link: string): Promise<EmbedData> {
    if (link.startsWith("/f/")) {
      const title = boxes.value.get(link) ?? "PDF"
      return pdfData(link, link, title, link).catch((error: unknown) => {
        reportClientError("doc-embed", error, { source: link })
        return { error: `“${title}” couldn't load here.` }
      })
    }
    const found = await $fetch<DropDetail>(`/api/drops/${encodeURIComponent(link)}`).catch(() => null)
    if (!found) return { error: UNREACHABLE }
    const video = found.kind === "file" ? videoType(found.filename) : undefined
    try {
      if (found.kind === "html" && found.content) return { kind: "html", html: found.content }
      if (found.kind === "image" && found.url)
        return { kind: "image", src: await blobDataUrl(await readBlob(found.url)) }
      if (video && found.url) return { kind: "video", data: await readBlob(found.url), mime: video }
      if (found.kind === "file" && found.url && isPdf(found.filename))
        return await pdfData(link, found.url, found.title, `/d/${link}`)
    } catch (error) {
      reportClientError("doc-embed", error, { drop: link })
      return { error: `“${found.title}” couldn't load here.` }
    }
    return { error: `“${found.title}” can't show here. Only HTML, PDF, image and video drops can show inside a doc.` }
  }
  function described(link: string) {
    let data = answers.get(link)
    if (!data) {
      data = read(link)
      answers.set(link, data)
    }
    return data
  }

  async function pinsOn(link: string, page: number): Promise<EmbedPin[]> {
    if (link.startsWith("/f/")) return []
    let list = threads.get(link)
    if (!list) {
      list = $fetch<DropComment[]>(`/api/drops/${encodeURIComponent(link)}/comments`).catch(() => [])
      threads.set(link, list)
    }
    return (await list)
      .filter((comment) => !comment.resolved && comment.pdfPage === page)
      .map(({ n, ox, oy, ow, oh }) => ({ n, x: ox, y: oy, ...(ow > 0 && oh > 0 ? { w: ow, h: oh } : {}) }))
  }

  function shownFor(id: string) {
    return (link: string) => drop.value.id === id && boxes.value.has(link)
  }
  async function sendEmbed(link: string, send: (message: EmbedMessage) => void) {
    const shown = shownFor(drop.value.id)
    if (!shown(link)) return
    const data = await described(link)
    if (!shown(link)) return
    const shows =
      "kind" in data && data.kind === "html" ? { ...data, html: embedDocument(data.html, dark.value) } : data
    send({ type: "embed-data", link, ...shows })
  }
  async function sendPage(link: string, n: number, send: (message: EmbedMessage) => void) {
    const shown = shownFor(drop.value.id)
    if (!shown(link)) return
    const data = await described(link)
    if (!("kind" in data) || data.kind !== "pdf") return
    const at = Math.min(Math.max(1, n), Math.min(data.pages, EMBED_PAGES))
    const key = `${at} ${link}`
    if (drawn.has(key)) return
    drawn.add(key)
    try {
      const [[image, links], pins] = await Promise.all([
        withPdf(link, sources.get(link) ?? link, (pdf) => Promise.all([renderPage(pdf, at), pageLinks(pdf, at)])),
        pinsOn(link, at),
      ])
      if (shown(link)) send({ type: "embed-page-data", link, page: at, ...image, links, pins })
    } catch (error) {
      reportClientError("doc-embed-page", error, { drop: link })
      if (shown(link)) send({ type: "embed-page-data", link, page: at, error: `Page ${at} couldn't be drawn.` })
    }
  }
  return {
    answer: (links: string[], send: (message: EmbedMessage) => void) => {
      for (const link of links) void sendEmbed(link, send)
    },
    page: (link: string, n: number, send: (message: EmbedMessage) => void) => void sendPage(link, n, send),
    reloaded: () => drawn.clear(),
  }
}
