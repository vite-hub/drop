<script setup lang="ts">
// A PDF file, drawn by pdf.js in Drop's own page. The browser's PDF viewer can't do it here: `/f/` files refuse every
// frame (X-Frame-Options, frame-ancestors), Chromium won't load a PDF in a sandboxed frame, and a native viewer can't
// say where on a page someone clicked. pdf.js keeps each page's text selectable and its links working, and draws only
// the pages near the view, so a long paper opens as fast as a short one.
import "pdfjs-dist/web/pdf_viewer.css"
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist"
import type { EventBus, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs"
import type { DropComment } from "#shared/types"

/** A page as a still: the page as a data URL and a PNG file, its number, and its box on the screen. */
export type PdfPage = {
  src: string
  file: File
  page: number
  rect: { left: number; top: number; width: number; height: number }
}

const props = defineProps<{
  src: string
  title: string
  /** The comments on its pages, pinned where they point. */
  comments?: DropComment[]
  canComment?: boolean
}>()
const emit = defineEmits<{
  /** Comment on the page in view. */
  page: [page: PdfPage]
  /** A comment's pin was clicked. */
  open: [comment: DropComment]
}>()

const container = useTemplateRef<HTMLDivElement>("container")
const viewerElement = useTemplateRef<HTMLDivElement>("viewerElement")
const notify = useNotify()

let task: PDFDocumentLoadingTask | null = null
let pdf: PDFDocumentProxy | null = null
let viewer: PDFViewer | null = null
let bus: EventBus | null = null
const lifecycle = new AbortController()
const loaded = ref(false)
const failed = ref(false)
const pages = ref(0)
const current = ref(1)
const scale = ref(1)
/** Bumped when pages move (zoom, resize, load), so the pins follow them. */
const layout = ref(0)

onMounted(async () => {
  try {
    // pdf.js reads browser globals when it loads, so it loads here, in the browser. pdf_viewer.mjs reads
    // globalThis.pdfjsLib, which pdf.mjs sets.
    const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")])
    lib.GlobalWorkerOptions.workerSrc = worker.default
    const { EventBus, PDFLinkService, PDFViewer, LinkTarget } = await import("pdfjs-dist/web/pdf_viewer.mjs")
    if (lifecycle.signal.aborted || !container.value || !viewerElement.value) return
    bus = new EventBus()
    const links = new PDFLinkService({ eventBus: bus, externalLinkTarget: LinkTarget.BLANK })
    // pdf.js 6.5 supports abortSignal at runtime but omits it from PDFViewerOptions.
    const options = {
      container: container.value,
      viewer: viewerElement.value,
      eventBus: bus,
      linkService: links,
      abortSignal: lifecycle.signal,
    }
    viewer = new PDFViewer(options)
    links.setViewer(viewer)
    bus.on("pagesinit", () => {
      // Fits the page's width up to a comfortable reading size, then leaves zoom to the reader.
      viewer!.currentScaleValue = "auto"
      loaded.value = true
      layout.value++
    })
    bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => (current.value = pageNumber))
    bus.on("scalechanging", ({ scale: next }: { scale: number }) => {
      scale.value = next
      void nextTick(() => layout.value++)
    })
    // The file comes from Drop's own origin with the reader's cookie, in ranges once the server says it can.
    // Compressed page images need pdf.js's binary decoders, including in comment snapshots.
    task = lib.getDocument({ url: props.src, wasmUrl: "/vendor/pdfjs/wasm/" })
    pdf = await task.promise
    if (lifecycle.signal.aborted) return
    pages.value = pdf.numPages
    viewer.setDocument(pdf)
    links.setDocument(pdf)
  } catch (error) {
    if (lifecycle.signal.aborted) return
    failed.value = true
    reportClientError("pdf", error)
  }
})
onBeforeUnmount(() => {
  // The lifecycle signal owns scroll/resize handlers; clearing the document releases copy listeners and canvases.
  lifecycle.abort()
  viewer?.setDocument(null)
  viewer = null
  pdf = null
  void task?.destroy()
})
useResizeObserver(container, () => {
  if (!viewer || !loaded.value) return
  // "auto" and "page-width" fit again when the pane changes size; a number the reader zoomed to stays.
  const fitted = viewer.currentScaleValue
  if (Number.isNaN(Number(fitted))) viewer.currentScaleValue = fitted
  layout.value++
})

const zoom = (steps: number) => viewer?.updateScale({ steps })
const fit = () => viewer && (viewer.currentScaleValue = "page-width")
const percent = computed(() => `${Math.round(scale.value * 100)}%`)

function go(page: number) {
  if (!viewer) return
  viewer.currentPageNumber = Math.min(Math.max(1, page), pages.value)
}
const pageInput = ref("")
watch(current, (page) => (pageInput.value = String(page)), { immediate: true })
function submitPage() {
  const page = Number.parseInt(pageInput.value, 10)
  if (page) go(page)
  pageInput.value = String(current.value)
}

/** The page's box on the screen, past its border. */
function pageBox(page: number) {
  const div = viewer?.getPageView(page - 1)?.div
  if (!div) return null
  const style = getComputedStyle(div)
  const x = Number.parseFloat(style.borderLeftWidth) || 0,
    y = Number.parseFloat(style.borderTopWidth) || 0
  return { div, x, y, width: div.clientWidth, height: div.clientHeight }
}

/** Page `page` drawn on its own, near 2000px on its long side, as a PNG: what a comment on it carries. */
async function pageAt(page = current.value): Promise<PdfPage | null> {
  // A comment's link can ask for its page before the pages are laid out.
  await until(() => loaded.value || failed.value).toBe(true, { timeout: 15000 })
  if (!pdf || !viewer || failed.value || lifecycle.signal.aborted) return null
  go(page)
  await nextTick()
  const proxy = await pdf.getPage(page)
  const base = proxy.getViewport({ scale: 1 })
  // Keeps the picture near 2000px on its long side, the size of a comment's other images.
  const viewport = proxy.getViewport({ scale: Math.min(4, 2000 / Math.max(base.width, base.height)) })
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await proxy.render({ canvas, viewport }).promise
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("The page couldn't be drawn."))), "image/png"),
  )
  const box = pageBox(page)
  const rect = box?.div.getBoundingClientRect()
  return {
    src: canvas.toDataURL("image/png"),
    file: new File([blob], `page-${page}.png`, { type: "image/png" }),
    page,
    rect: rect
      ? { left: rect.left + box!.x, top: rect.top + box!.y, width: box!.width, height: box!.height }
      : { left: 0, top: 0, width: 0, height: 0 },
  }
}

const taking = ref(false)
async function commentOnPage() {
  if (taking.value) return
  taking.value = true
  try {
    const still = await pageAt()
    if (still) emit("page", still)
  } catch (error) {
    reportClientError("pdf-page", error)
    notify.alert("Couldn't take the page")
  } finally {
    taking.value = false
  }
}

// Each comment's pin on its page, and the box of an area, in the scrolling pane's coordinates, so they move with it.
const pins = computed(() => {
  void layout.value
  if (!loaded.value) return []
  return (props.comments ?? []).flatMap((comment) => {
    if (comment.pdfPage === null) return []
    const box = pageBox(comment.pdfPage)
    if (!box) return []
    const left = box.div.offsetLeft + box.x,
      top = box.div.offsetTop + box.y
    return [
      {
        comment,
        pin: {
          left: `${left + (comment.ox / 1000) * box.width}px`,
          top: `${top + (comment.oy / 1000) * box.height}px`,
        },
        area: comment.ow
          ? {
              left: `${left + (comment.ox / 1000) * box.width}px`,
              top: `${top + (comment.oy / 1000) * box.height}px`,
              width: `${(comment.ow / 1000) * box.width}px`,
              height: `${(comment.oh / 1000) * box.height}px`,
            }
          : null,
      },
    ]
  })
})

defineExpose({ pageAt })
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col bg-elevated">
    <!-- pdf.js wants its pane absolutely placed, and scrolls it itself. -->
    <div ref="container" class="pdf-pane absolute inset-0 overflow-auto" :aria-label="title" role="document">
      <div ref="viewerElement" class="pdfViewer" />
      <template v-for="{ comment, pin, area } in pins" :key="comment.id">
        <div v-if="area" class="pdf-area" :class="{ done: comment.resolved }" :style="area" />
        <UTooltip :text="`#${comment.n} ${comment.body || 'image'}`">
          <button
            type="button"
            class="pdf-pin"
            :class="{ done: comment.resolved }"
            :style="pin"
            :aria-label="`Comment #${comment.n} on page ${comment.pdfPage}`"
            @click="emit('open', comment)"
          >
            {{ comment.n }}
          </button>
        </UTooltip>
      </template>
    </div>
    <div v-if="failed" class="absolute inset-0 grid place-items-center p-10 text-center text-sm text-muted">
      This PDF couldn't be shown. Download it to read it.
    </div>
    <div v-else-if="!loaded" class="absolute inset-0 grid place-items-center text-sm text-muted">
      <UIcon name="i-mingcute-loading-line" class="size-5 animate-spin" />
    </div>
    <!-- Page and zoom, over the top of the pane, out of the review dock's way at the bottom. -->
    <div
      v-if="loaded"
      class="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-default bg-default/90 p-1 shadow-sm backdrop-blur"
    >
      <form class="flex items-center gap-1 px-1 font-mono text-xs text-muted tabular-nums" @submit.prevent="submitPage">
        <input
          v-model="pageInput"
          aria-label="Page"
          class="w-9 rounded border border-default bg-default px-1 py-0.5 text-center text-default"
          inputmode="numeric"
          @blur="submitPage"
        />
        <span>/ {{ pages }}</span>
      </form>
      <USeparator class="mx-1 h-4" orientation="vertical" />
      <UTooltip text="Zoom out">
        <UButton
          aria-label="Zoom out"
          color="neutral"
          icon="i-mingcute-minimize-line"
          size="xs"
          variant="ghost"
          @click="zoom(-1)"
        />
      </UTooltip>
      <UTooltip text="Fit width">
        <UButton
          class="font-mono tabular-nums"
          color="neutral"
          :label="percent"
          size="xs"
          variant="ghost"
          @click="fit"
        />
      </UTooltip>
      <UTooltip text="Zoom in">
        <UButton
          aria-label="Zoom in"
          color="neutral"
          icon="i-mingcute-add-line"
          size="xs"
          variant="ghost"
          @click="zoom(1)"
        />
      </UTooltip>
      <template v-if="canComment">
        <USeparator class="mx-1 h-4" orientation="vertical" />
        <UTooltip :text="`Comment on page ${current}`">
          <UButton
            :aria-label="`Comment on page ${current}`"
            color="neutral"
            icon="i-mingcute-chat-3-line"
            :loading="taking"
            size="xs"
            variant="ghost"
            @click="commentOnPage"
          />
        </UTooltip>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Room for the page and zoom bar at the top and the review dock at the bottom. */
.pdf-pane :deep(.pdfViewer) {
  padding: 3.5rem 0 7rem;
}
.pdf-pane :deep(.pdfViewer .page) {
  border: 0;
  margin: 0 auto 1rem;
  box-shadow:
    0 1px 3px rgb(0 0 0 / 0.12),
    0 8px 24px rgb(0 0 0 / 0.08);
}
/* Drop's pin (shared/plan-runtime.ts), its sharp corner on the spot. */
.pdf-pin {
  position: absolute;
  z-index: 5;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 2px 11px 11px 11px;
  background: var(--primary);
  color: var(--primary-foreground);
  font: 600 10px/22px var(--font-sans);
  font-variant-numeric: tabular-nums;
  box-shadow:
    0 1px 4px rgb(0 0 0 / 0.25),
    0 0 0 2px var(--background);
  cursor: pointer;
  transition: scale 150ms cubic-bezier(0.23, 1, 0.32, 1);
  transform-origin: top left;
}
.pdf-pin:hover {
  scale: 1.1;
}
.pdf-pin:active {
  scale: 0.96;
}
.pdf-pin:focus-visible {
  outline: 2px solid var(--foreground);
  outline-offset: 2px;
}
.pdf-area {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  border: 2px solid var(--primary);
  border-radius: 2px;
  background: color-mix(in srgb, var(--primary) 8%, transparent);
}
.done {
  opacity: 0.55;
  filter: grayscale(1);
}
@media (prefers-reduced-motion: reduce) {
  .pdf-pin {
    transition: none;
  }
}
</style>
