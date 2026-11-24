import type { PDFDocumentProxy } from "pdfjs-dist"
import { MAX_PDFS } from "#shared/embedded-images"
import { EMBED_PAGES, type EmbedData, type EmbedMessage, type EmbedPin } from "#shared/frame-messages"
import { embedDocument } from "#shared/plan-runtime"
import { isPdf, videoType } from "#shared/plans"
import type { DropComment, DropDetail } from "#shared/types"

const UNREACHABLE = "This drop is private, expired, or deleted, so it can't show here."
const PAST_CAP = `Only the first ${MAX_PDFS} attached PDFs show inside a doc; open it: `
const OPEN_PDFS = 4
const STALE = new Error("The doc's frame asking for this has gone")

const readBlob = (url: string) => $fetch<Blob>(url, { responseType: "blob" })
const close = (pdf: PDFDocumentProxy) => pdf.loadingTask.destroy()

type Read = { data: EmbedData; src?: string }

export function useDocEmbeds(
  drop: Ref<DropDetail>,
  attached: { pdfs: Ref<string[]>; pdfOf: (src: string) => string | undefined },
  dark: Ref<boolean>,
) {
  const boxes = computed(() => {
    const titles = new Map<string, string>()
    if (drop.value.kind !== "markdown") return titles
    const template = globalThis.document?.createElement("template")
    if (!template) return titles
    template.innerHTML = drop.value.html ?? ""
    for (const box of template.content.querySelectorAll("figure.drop-embed")) {
      const src = box.getAttribute("data-drop-src")
      const link = box.getAttribute("data-drop-embed") ?? (src && attached.pdfOf(src))
      if (link) titles.set(link, box.getAttribute("data-title") || "PDF")
    }
    return titles
  })

  const pdfs = new Map<string, PDFDocumentProxy>()
  let generation = 0
  let queue: Promise<unknown> = Promise.resolve()
  function withPdf<T>(src: string, use: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
    const asked = generation
    const turn = queue.then(async () => {
      if (asked !== generation) throw STALE
      let pdf = pdfs.get(src)
      pdfs.delete(src)
      pdf ??= await openPdf(src)
      pdfs.set(src, pdf)
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
  const answers = new Map<string, Promise<Read>>()
  const threads = new Map<string, Promise<DropComment[]>>()
  const drawn = new Set<string>()
  function reloaded() {
    generation++
    drawn.clear()
    answers.clear()
    threads.clear()
  }
  function forget() {
    reloaded()
    queue = queue.then(() => {
      const open = [...pdfs.values()]
      pdfs.clear()
      return Promise.allSettled(open.map(close))
    })
  }
  watch([() => drop.value.id, () => drop.value.version], forget)
  onScopeDispose(forget)

  async function pdfData(src: string, title: string, href: string): Promise<Read> {
    const pages = await withPdf(src, async (pdf) => pdf.numPages)
    return { data: { kind: "pdf", pages, title, href }, src }
  }
  async function read(link: string, asked: number): Promise<Read> {
    if (link.startsWith("/f/")) {
      const title = boxes.value.get(link) ?? "PDF"
      if (!attached.pdfs.value.includes(link)) return { data: { error: PAST_CAP, href: link } }
      return pdfData(link, title, link).catch((error: unknown) => {
        if (error !== STALE) reportClientError("doc-embed", error, { source: link })
        return { data: { error: `“${title}” couldn't load here.` } }
      })
    }
    const found = await $fetch<DropDetail>(`/api/drops/${encodeURIComponent(link)}`).catch(() => null)
    if (!found || asked !== generation) return { data: { error: UNREACHABLE } }
    const video = found.kind === "file" ? videoType(found.filename) : undefined
    try {
      if (found.kind === "html" && found.content) return { data: { kind: "html", html: found.content } }
      if (found.kind === "image" && found.url)
        return { data: { kind: "image", src: await blobDataUrl(await readBlob(found.url)) } }
      if (video && found.url) return { data: { kind: "video", data: await readBlob(found.url), mime: video } }
      if (found.kind === "file" && found.url && isPdf(found.filename))
        return await pdfData(found.url, found.title, `/d/${link}`)
    } catch (error) {
      if (error !== STALE) reportClientError("doc-embed", error, { drop: link })
      return { data: { error: `“${found.title}” couldn't load here.` } }
    }
    return {
      data: { error: `“${found.title}” can't show here. Only HTML, PDF, image and video drops can show inside a doc.` },
    }
  }
  function described(link: string) {
    let data = answers.get(link)
    if (!data) {
      data = read(link, generation)
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
      .filter((comment) => comment.pdfPage === page)
      .map(({ n, ox, oy, ow, oh, resolved }) => ({
        n,
        x: ox,
        y: oy,
        ...(ow > 0 && oh > 0 ? { w: ow, h: oh } : {}),
        ...(resolved ? { resolved: true as const } : {}),
      }))
  }

  function shownFor(id: string) {
    const asked = generation
    return (link: string) => drop.value.id === id && asked === generation && boxes.value.has(link)
  }
  async function sendEmbed(link: string, send: (message: EmbedMessage) => void) {
    const shown = shownFor(drop.value.id)
    if (!shown(link)) return
    const { data } = await described(link)
    if (!shown(link)) return
    const shows =
      "kind" in data && data.kind === "html" ? { ...data, html: embedDocument(data.html, dark.value) } : data
    send({ type: "embed-data", link, ...shows })
  }
  async function sendPage(link: string, n: number, send: (message: EmbedMessage) => void) {
    const shown = shownFor(drop.value.id)
    if (!shown(link)) return
    const { data, src } = await described(link)
    if (!shown(link) || !src || !("kind" in data) || data.kind !== "pdf") return
    const at = Math.min(Math.max(1, n), Math.min(data.pages, EMBED_PAGES))
    const key = `${at} ${link}`
    if (drawn.has(key)) return
    drawn.add(key)
    try {
      const [[image, links], pins] = await Promise.all([
        withPdf(src, (pdf) => Promise.all([renderPage(pdf, at), pageLinks(pdf, at)])),
        pinsOn(link, at),
      ])
      if (shown(link)) send({ type: "embed-page-data", link, page: at, ...image, links, pins })
    } catch (error) {
      if (error === STALE) return
      reportClientError("doc-embed-page", error, { drop: link })
      if (shown(link)) send({ type: "embed-page-data", link, page: at, error: `Page ${at} couldn't be drawn.` })
    }
  }
  return {
    answer: (links: string[], send: (message: EmbedMessage) => void) => {
      for (const link of links) void sendEmbed(link, send)
    },
    page: (link: string, n: number, send: (message: EmbedMessage) => void) => void sendPage(link, n, send),
    reloaded,
  }
}
