<script setup lang="ts">
import "pdfjs-dist/web/pdf_viewer.css"
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist"
import type { EventBus, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs"
import type { DropComment } from "#shared/types"

export type PdfPage = {
  src: string
  file: File
  page: number
  rect: { left: number; top: number; width: number; height: number }
}

const props = defineProps<{
  src: string
  title: string
  comments?: DropComment[]
  canComment?: boolean
}>()
const emit = defineEmits<{
  page: [page: PdfPage]
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
const layout = ref(0)

onMounted(async () => {
  try {
    const lib = await pdfjs()
    const { EventBus, PDFLinkService, PDFViewer, LinkTarget } = await import("pdfjs-dist/web/pdf_viewer.mjs")
    if (lifecycle.signal.aborted || !container.value || !viewerElement.value) return
    bus = new EventBus()
    const links = new PDFLinkService({ eventBus: bus, externalLinkTarget: LinkTarget.BLANK })
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
      viewer!.currentScaleValue = "auto"
      loaded.value = true
      layout.value++
    })
    bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => (current.value = pageNumber))
    bus.on("scalechanging", ({ scale: next }: { scale: number }) => {
      scale.value = next
      void nextTick(() => layout.value++)
    })
    task = lib.getDocument({ url: props.src, wasmUrl: PDF_WASM_URL })
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
  lifecycle.abort()
  viewer?.setDocument(null)
  viewer = null
  pdf = null
  void task?.destroy()
})
useResizeObserver(container, () => {
  if (!viewer || !loaded.value) return
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

function pageBox(page: number) {
  const div = viewer?.getPageView(page - 1)?.div
  if (!div) return null
  const style = getComputedStyle(div)
  const x = Number.parseFloat(style.borderLeftWidth) || 0,
    y = Number.parseFloat(style.borderTopWidth) || 0
  return { div, x, y, width: div.clientWidth, height: div.clientHeight }
}

async function pageAt(page = current.value): Promise<PdfPage | null> {
  await until(() => loaded.value || failed.value).toBe(true, { timeout: 15000 })
  if (!pdf || !viewer || failed.value || lifecycle.signal.aborted) return null
  go(page)
  await nextTick()
  const canvas = await drawPage(pdf, page, { longest: 2000 })
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

const numberOf = (comment: DropComment) => (comment.delivery ? waitingLabel(comment.delivery) : `#${comment.n}`)

defineExpose({ pageAt })
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col bg-elevated">
    <div ref="container" class="pdf-pane absolute inset-0 overflow-auto" :aria-label="title" role="document">
      <div ref="viewerElement" class="pdfViewer" />
      <template v-for="{ comment, pin, area } in pins" :key="comment.id">
        <div v-if="area" class="pdf-area" :class="{ done: comment.resolved }" :style="area" />
        <UTooltip :text="`${numberOf(comment)} ${comment.body || 'image'}`">
          <button
            type="button"
            class="pdf-pin"
            :class="{ done: comment.resolved }"
            :data-delivery="comment.delivery?.status"
            :style="pin"
            :aria-label="
              comment.delivery
                ? `Comment on page ${comment.pdfPage}, ${waitingLabel(comment.delivery).toLowerCase()}`
                : `Comment #${comment.n} on page ${comment.pdfPage}`
            "
            @click="emit('open', comment)"
          >
            <UIcon v-if="comment.delivery" name="i-mingcute-time-line" class="size-3 align-[-2px]" />
            <template v-else>{{ comment.n }}</template>
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
.pdf-pin[data-delivery="failed"] {
  background: var(--destructive);
  color: var(--destructive-foreground);
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
