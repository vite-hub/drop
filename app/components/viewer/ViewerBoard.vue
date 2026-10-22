<script setup lang="ts">
// A board drop: Excalidraw, mounted as a React root inside this Vue component and loaded only on boards. People draw;
// each changed element goes to the server a moment later, and every few seconds the board pulls what others and agents
// changed and merges it the way Excalidraw's own collaboration does (higher version wins, reconcileElements). After a
// save, the browser renders the whole board and each frame as PNG for agents (view_board), since Excalidraw only
// renders in a browser. The server records who added each element, which read_drop's outline shows.
import type { Board, BoardElement } from "#shared/board"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail; inset?: number }>()
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
      $fetch<{ snapshot: Board; canEdit: boolean }>(`/api/drops/${id}/board`),
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
          createElement(
            ex.MainMenu,
            null,
            createElement(ex.MainMenu.DefaultItems.SaveAsImage),
            createElement(ex.MainMenu.DefaultItems.SearchMenu),
            createElement(ex.MainMenu.DefaultItems.Help),
          ),
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
const FAMILIES: Record<number, string> = { 1: "Virgil", 2: "Helvetica", 3: "Cascadia", 5: "Excalifont", 6: "Nunito" }
const fontOf = (text: { fontSize: number; fontFamily: number }) =>
  `${text.fontSize}px ${FAMILIES[text.fontFamily] ?? "Helvetica"}, Segoe UI Emoji`

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
    const remote = ex.restoreElements(newer as never, null, { repairBindings: true })
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
      const [dx, dy] = container.type === "arrow" ? (container.points.at(-1) ?? [0, 0]) : [box.width, box.height]
      const cx = box.x + dx / 2
      const cy = box.y + dy / 2
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
    <!-- The board keeps clear of the floating panel, like a doc's text (FLOATING_INSET). -->
    <div ref="host" class="board absolute inset-y-0 left-0" :style="{ right: `${inset ?? 0}px` }" />
    <div v-if="state !== 'ready'" class="absolute inset-0 grid place-items-center text-sm text-muted">
      <span v-if="state === 'loading'" class="flex items-center gap-2">
        <UIcon name="i-mingcute-loading-line" class="size-4 animate-spin" />
        Loading the board…
      </span>
      <span v-else>This board couldn't be opened. Reload to try again.</span>
    </div>
    <div
      v-if="state === 'ready'"
      class="pointer-events-none absolute bottom-3 left-1/2 z-[300] -translate-x-1/2 text-xs text-dimmed"
      aria-live="polite"
    >
      {{ readOnly ? "View only" : saving ? "Saving…" : "" }}
    </div>
  </div>
</template>

<style>
/*
 * Excalidraw's interface in Drop's tokens (shared/theme.css, app/assets/css/main.css): its panels, menus and buttons
 * use Drop's surfaces, text, primary and Geist, and its own `.theme--dark` follows Drop's theme (the theme prop). The
 * drawings keep Excalidraw's look: the canvas and its shapes aren't interface.
 */
.board .excalidraw {
  --ui-font: var(--font-sans, inherit);
  --color-primary: var(--ui-primary);
  --color-primary-darker: var(--ui-primary);
  --color-primary-darkest: var(--ui-primary);
  --color-primary-light: color-mix(in oklab, var(--ui-primary) 15%, transparent);
  --island-bg-color: var(--popover);
  --default-bg-color: var(--ui-bg);
  --input-bg-color: var(--ui-bg);
  --text-primary-color: var(--ui-text-highlighted);
}
/* The library holds people's saved shapes in their own browser; a shared board has no use for it. */
.board .excalidraw .default-sidebar-trigger {
  display: none;
}
</style>
