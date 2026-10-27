<script setup lang="ts">
// A board drop: Excalidraw, mounted as a React root inside this Vue component and loaded only on boards. People draw;
// each changed element goes to the server a moment later, and every few seconds the board pulls what others and agents
// changed and merges it the way Excalidraw's own collaboration does (higher version wins, reconcileElements). After a
// save, the browser renders the whole board and each frame as PNG for agents (view_board), since Excalidraw only
// renders in a browser. The server records who added each element, which read_drop's outline shows.
import type { Board, BoardElement } from "#shared/board"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const host = useTemplateRef<HTMLElement>("host")
const colorMode = useColorMode()
const state = ref<"loading" | "ready" | "failed">("loading")
const saving = ref(false)
const readOnly = ref(true)

type Excalidraw = typeof import("@excalidraw/excalidraw")
type Api = import("@excalidraw/excalidraw/types").ExcalidrawImperativeAPI
let root: import("react-dom/client").Root | undefined
let stop: (() => void) | undefined
let left = false

onMounted(async () => {
  const id = props.drop.id
  try {
    const [{ createElement }, { createRoot }, ex, data] = await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("@excalidraw/excalidraw"),
      $fetch<{ snapshot: Board; canEdit: boolean }>(`/api/drops/${id}/board`, { query: { v: props.drop.version } }),
      import("@excalidraw/excalidraw/index.css"),
    ])
    // The reader left while Excalidraw loaded: there's no host to mount in any more.
    if (left) return
    readOnly.value = !data.canEdit
    const elements = data.snapshot.elements
    let onChange: ((elements: readonly BoardElement[]) => void) | undefined
    root = createRoot(host.value!)
    const render = () =>
      root?.render(
        createElement(
          ex.Excalidraw,
          {
            // SAFETY: the server stores only elements with the fields Excalidraw's restore needs (isBoardElement).
            initialData: {
              elements: elements as never,
              appState: { viewBackgroundColor: "transparent" },
              scrollToContent: true,
            },
            theme: colorMode.value === "dark" ? "dark" : "light",
            viewModeEnabled: !data.canEdit,
            name: props.drop.title,
            // Drop's header already names the board, holds its menu and shares it, and the board saves on its own:
            // Excalidraw's open, save, reset and background controls would repeat it or fight the sync. Images need
            // files Drop doesn't keep.
            UIOptions: {
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                export: false,
                clearCanvas: false,
                changeViewBackgroundColor: false,
                toggleTheme: false,
              },
              tools: { image: false },
            },
            excalidrawAPI: (ready: Api) => {
              // In dev, the editor on window lets a browser session inspect and drive the board.
              if (import.meta.dev) Object.assign(window, { boardApi: ready })
              ;({ stop, onChange } = sync(ex, ready, data.snapshot.elements, data.canEdit))
              state.value = "ready"
            },
            // SAFETY: Excalidraw's elements are plain objects with the fields BoardElement names.
            onChange: (changed: readonly unknown[]) => onChange?.(changed as readonly BoardElement[]),
          },
          // An empty main menu: its button is hidden (below), and Help stays in the footer.
          createElement(ex.MainMenu),
        ),
      )
    render()
    // Excalidraw follows Drop's theme; re-rendering only passes the new prop, the scene stays.
    watch(() => colorMode.value, render)
  } catch (error) {
    console.error(error)
    state.value = "failed"
  }
})
onBeforeUnmount(() => {
  left = true
  stop?.()
  root?.unmount()
})

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// Excalidraw's label layout (its BOUND_TEXT_PADDING, getBoundTextMaxWidth and getFontString), for agents' words.
const PADDING = 5
type Shape = { type: string; width: number; fontSize?: number }
function labelWidth(container: Shape) {
  if (container.type === "arrow") return Math.max(0.7 * container.width, 16 * 11)
  if (container.type === "ellipse") return Math.round((container.width / 2) * Math.SQRT2) - PADDING * 2
  if (container.type === "diamond") return Math.round(container.width / 2) - PADDING * 2
  return container.width - PADDING * 2
}
const FAMILIES = new Map([
  [1, "Virgil"],
  [2, "Helvetica"],
  [3, "Cascadia"],
  [5, "Excalifont"],
  [6, "Nunito"],
])
const fontOf = (text: { fontSize: number; fontFamily: number }) =>
  `${text.fontSize}px ${FAMILIES.get(text.fontFamily) ?? "Helvetica"}, Segoe UI Emoji`

// Excalidraw centers bound text at the middle vertex of odd-point polylines, or
// the midpoint of the middle segment for even-point polylines.
function arrowMidpoint(points: ReadonlyArray<ReadonlyArray<number>>): [number, number] {
  if (!points.length) return [0, 0]
  const middle = Math.floor(points.length / 2)
  const middlePoint = points[middle]
  if (!middlePoint) return [0, 0]
  const [middleX, middleY] = middlePoint
  if (points.length % 2) return [middleX ?? 0, middleY ?? 0]
  const previousPoint = points[middle - 1]
  if (!previousPoint) return [middleX ?? 0, middleY ?? 0]
  const [x1, y1] = previousPoint
  const [x2, y2] = middlePoint
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return [0, 0]
  return [(x1 + x2) / 2, (y1 + y2) / 2]
}

let measuring: CanvasRenderingContext2D | null = null
/** Words wrapped to `max` px wide the way Excalidraw wraps them: at spaces, and inside words longer than a line. */
function wrap(text: string, font: string, max: number) {
  measuring ??= document.createElement("canvas").getContext("2d")!
  measuring.font = font
  const ctx = measuring
  const measure = (line: string) => ctx.measureText(line).width
  const lines: { text: string; width: number }[] = []
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= max) {
        line = candidate
        continue
      }
      if (line) lines.push({ text: line, width: measure(line) })
      line = ""
      for (const char of word) {
        if (line && measure(line + char) > max) {
          lines.push({ text: line, width: measure(line) })
          line = ""
        }
        line += char
      }
    }
    lines.push({ text: line, width: measure(line) })
  }
  return lines
}

function sync(ex: Excalidraw, api: Api, initial: BoardElement[], canEdit: boolean) {
  const id = props.drop.id
  // The version of each element the server has, and the elements changed here that it doesn't have yet.
  const known = new Map(initial.map((element) => [element.id, element.version]))
  const pending = new Map<string, BoardElement>()

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let imageTimer: ReturnType<typeof setTimeout> | undefined
  let busy: Promise<unknown> = Promise.resolve()
  const schedule = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => (busy = busy.then(save)), 700)
  }
  // Excalidraw calls this on every change, the pointer's and the selection's too: only elements with a version the
  // server hasn't seen go out.
  // Excalidraw loads its initial scene after it hands over its API: the first change with elements is the board.
  let loaded = false
  const onChange = (elements: readonly BoardElement[]) => {
    if (!loaded && elements.length) {
      loaded = true
      measure()
    }
    if (!canEdit) return
    let any = false
    for (const element of elements)
      if (element.version > (known.get(element.id) ?? 0)) {
        pending.set(element.id, element)
        any = true
      }
    if (any) schedule()
  }

  async function save() {
    if (!pending.size) return
    // Excalidraw changes elements in place, so the copy is what gets sent, and its versions are what the server has.
    const elements = structuredClone([...pending.values()])
    pending.clear()
    saving.value = true
    try {
      // doctor-disable-next-line nuxt/fetch/no-raw-fetch-in-setup -- a save, from Excalidraw's callbacks in the browser
      await $fetch(`/api/drops/${id}/board`, { method: "POST", body: { elements } })
      for (const element of elements)
        if (element.version > (known.get(element.id) ?? 0)) known.set(element.id, element.version)
      clearTimeout(imageTimer)
      imageTimer = setTimeout(() => void images(), 4000)
    } catch (error) {
      // Kept for the next save, unless something newer replaced them meanwhile.
      for (const element of elements) if (!pending.has(element.id)) pending.set(element.id, element)
      console.error("Board save failed", error)
    } finally {
      saving.value = false
    }
  }

  // Others' and agents' changes: elements whose version is newer than this browser's, merged as Excalidraw merges.
  async function pull() {
    if (document.hidden) return
    await busy
    const data = await $fetch<{ snapshot: Board }>(`/api/drops/${id}/board`).catch(() => null)
    if (!data) return
    const local = new Map(api.getSceneElementsIncludingDeleted().map((element) => [element.id, element.version]))
    const newer = data.snapshot.elements.filter((element) => element.version > (local.get(element.id) ?? 0))
    for (const element of data.snapshot.elements)
      if (element.version > (known.get(element.id) ?? 0)) known.set(element.id, element.version)
    if (!newer.length) return
    // SAFETY: newer contains the server's serialized Excalidraw elements, which restoreElements accepts as unknown input.
    // This is only a partial scene. Repairing bindings here would clear a bound text or arrow's
    // references when its unchanged container is not included in this batch.
    const remote = ex.restoreElements(newer as never, null, { repairBindings: false })
    const elements = ex.reconcileElements(
      api.getSceneElementsIncludingDeleted(),
      // SAFETY: elements from the server, restored by Excalidraw: what reconcileElements calls remote elements.
      remote as never,
      api.getAppState(),
    )
    api.updateScene({ elements, captureUpdate: ex.CaptureUpdateAction.NEVER })
    measure()
    // An agent's edit shows in its next view_board too.
    clearTimeout(imageTimer)
    imageTimer = setTimeout(() => void images(), 4000)
  }
  const poll = setInterval(() => void pull(), 3000)

  // A new version for people who can draw, so it saves; a reader's copy stays at the server's version.
  type Element = ReturnType<Api["getSceneElementsIncludingDeleted"]>[number]
  const next = <T extends Element>(element: T, fields: Partial<T>) =>
    // SAFETY: spreading an Element and Partial<T> preserves the concrete element shape for this generic helper.
    ({
      ...element,
      ...fields,
      ...(canEdit && { version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) }),
    }) as T

  // Words an agent wrote reach the board unmeasured (`fit`, shared/board.ts): they're wrapped to their shape here, the
  // shape grows to hold them, and someone who can draw saves the result, so the next reader and view_board get it as
  // it is. Only those: people's own text is Excalidraw's, measured when they typed it.
  function measure() {
    const scene = api.getSceneElementsIncludingDeleted()
    const byId = new Map(scene.map((element) => [element.id, element]))
    const changed = new Map<string, (typeof scene)[number]>()
    for (const element of scene) {
      if (element.isDeleted || element.type !== "text" || !element.customData?.fit) continue
      const { fit: _, ...customData } = element.customData
      const container = element.containerId ? byId.get(element.containerId) : undefined
      const lines = wrap(element.originalText, fontOf(element), container ? labelWidth(container) : element.width)
      const width = Math.max(...lines.map((line) => line.width))
      const height = lines.length * element.fontSize * element.lineHeight
      const fields = { text: lines.map((line) => line.text).join("\n"), width, height, customData }
      if (!container) {
        changed.set(element.id, next(element, { ...fields, width: element.width }))
        continue
      }
      // A shape grows down to hold its label; an arrow's label sits on its middle.
      let box = container
      if (container.type !== "arrow" && height + PADDING * 2 > container.height) {
        box = next(container, { height: height + PADDING * 4 })
        changed.set(container.id, box)
      }
      const [dx, dy] = container.type === "arrow" ? arrowMidpoint(container.points) : [box.width / 2, box.height / 2]
      const cx = box.x + dx
      const cy = box.y + dy
      changed.set(element.id, next(element, { ...fields, x: cx - width / 2, y: cy - height / 2 }))
    }
    if (!changed.size) return
    api.updateScene({
      elements: scene.map((element) => changed.get(element.id) ?? element),
      captureUpdate: ex.CaptureUpdateAction.NEVER,
    })
  }

  // Open on the whole board, never zoomed past 100%: wide frames otherwise start off screen.
  requestAnimationFrame(() =>
    api.scrollToContent(api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.95, maxZoom: 1 }),
  )

  async function images() {
    if (!canEdit) return
    const elements = api.getSceneElements()
    if (!elements.length) return
    // At most 1600 px on the long side: readable for a model, small enough to send.
    const render = async (frame: (typeof elements)[number] | null) => {
      const blob = await ex.exportToBlob({
        elements,
        files: api.getFiles(),
        // SAFETY: exportToBlob accepts an Excalidraw element or null; this frame is one of the scene elements.
        exportingFrame: frame as never,
        appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
        exportPadding: 24,
        mimeType: "image/png",
        getDimensions: (width: number, height: number) => {
          const scale = Math.min(2, 1600 / Math.max(width, height, 1))
          return { width: width * scale, height: height * scale, scale }
        },
      })
      return toBase64(blob)
    }
    try {
      const frames = elements.filter((element) => element.type === "frame").slice(0, 20)
      const out = [{ frame: "overview", png: await render(null) }]
      for (const frame of frames) out.push({ frame: frame.id, png: await render(frame) })
      // doctor-disable-next-line nuxt/fetch/no-raw-fetch-in-setup -- an upload, from Excalidraw's callbacks in the browser
      await $fetch(`/api/drops/${id}/board/images`, { method: "POST", body: { images: out } })
    } catch (error) {
      console.error("Board images failed", error)
    }
  }
  // The first person to open a board an agent made gives agents its first images.
  if (canEdit) imageTimer = setTimeout(() => void images(), 1500)

  const flush = () => void save()
  window.addEventListener("pagehide", flush)
  return {
    onChange,
    stop: () => {
      window.removeEventListener("pagehide", flush)
      clearInterval(poll)
      clearTimeout(imageTimer)
      clearTimeout(saveTimer)
      if (pending.size) void save()
    },
  }
}
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div ref="host" class="board absolute inset-0" />
    <div v-if="state !== 'ready'" class="absolute inset-0 grid place-items-center text-sm text-muted">
      <span v-if="state === 'loading'" class="flex items-center gap-2">
        <UIcon name="i-mingcute-loading-line" class="size-4 animate-spin" />
        Loading the board…
      </span>
      <span v-else>This board couldn't be opened. Reload to try again.</span>
    </div>
    <div
      v-if="state === 'ready'"
      class="pointer-events-none absolute top-3 left-1/2 z-[300] -translate-x-1/2 text-xs text-dimmed"
      aria-live="polite"
    >
      {{ readOnly ? "View only" : saving ? "Saving…" : "" }}
    </div>
  </div>
</template>

<style>
/*
 * Excalidraw's interface in Drop's tokens (shared/theme.css, app/assets/css/main.css), laid out like a Drop page: the
 * tools sit in one bar at the bottom, as in Figma or tldraw, the main menu is gone (Drop's header holds the board's
 * actions, and Help stays in the footer), and panels and the bar are popovers with a hairline. The drawings keep
 * Excalidraw's look: the canvas and its shapes aren't interface. `.theme--dark` is listed so these beat Excalidraw's
 * own dark values; Drop's tokens follow `.dark` by themselves.
 */
.board .excalidraw,
.board .excalidraw.theme--dark {
  --ui-font: var(--font-sans, inherit);
  --color-primary: var(--ui-primary);
  --color-primary-darker: var(--ui-primary);
  --color-primary-darkest: var(--ui-primary);
  --color-primary-light: var(--ui-bg-accented);
  --color-primary-hover: var(--ui-primary);
  --island-bg-color: var(--popover);
  --default-bg-color: var(--ui-bg);
  --input-bg-color: var(--ui-bg);
  --text-primary-color: var(--ui-text-highlighted);
  --icon-fill-color: var(--ui-text);
  --default-border-color: var(--ui-border);
  --button-hover-bg: var(--ui-bg-elevated);
  --color-surface-primary-container: var(--ui-bg-inverted);
  --color-on-primary-container: var(--ui-text-inverted);
  --border-radius-lg: var(--radius);
  --shadow-island: 0 1px 2px rgb(0 0 0 / 0.05), 0 4px 12px -2px rgb(0 0 0 / 0.08), inset 0 0 0 1px var(--ui-border);
}
.dark .board .excalidraw {
  --shadow-island: 0 1px 2px rgb(0 0 0 / 0.3), 0 4px 12px -2px rgb(0 0 0 / 0.4), inset 0 0 0 1px var(--ui-border);
}

/* The main menu's button, and the library, which holds people's saved shapes in their own browser. */
.board .excalidraw .main-menu-trigger,
.board .excalidraw .default-sidebar-trigger {
  display: none;
}

/* The tool bar, at the bottom in the middle, level with the zoom and help in the footer; its hint shows above it. */
.board .excalidraw:not(.excalidraw--mobile) .shapes-section {
  position: absolute;
  bottom: 0;
  left: 50%;
  translate: -50% 0;
}
.board .excalidraw:not(.excalidraw--mobile) .shapes-section .HintViewer {
  top: auto;
  bottom: 100%;
  margin: 0 0 0.5rem;
  color: var(--ui-text-dimmed);
}
.board .excalidraw .App-toolbar .Island {
  padding: 0.25rem;
}
.board .excalidraw .App-toolbar .ToolIcon__icon {
  border-radius: calc(var(--radius) * 0.8);
}
/* Each tool's shortcut is in its tooltip; the digits under every icon were noise. */
.board .excalidraw .App-toolbar .ToolIcon__keybinding {
  display: none;
}
</style>
