<script setup lang="ts">
// A board drop: tldraw, mounted as a React root inside this Vue component and loaded only on boards. People draw;
// each change goes to the server a moment later (only document records, never cameras or selections), and every few
// seconds the board pulls what others and agents changed. After a save, the browser renders the whole board and each
// frame as PNG for agents (view_board), since tldraw only renders in a browser. Shapes people add carry their name in
// `meta.author`, which read_drop's outline shows.
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail; inset?: number }>()
const host = useTemplateRef<HTMLElement>("host")
const { data: me } = useMe()
const colorMode = useColorMode()
const config = useRuntimeConfig()
const state = ref<"loading" | "ready" | "failed">("loading")
const saving = ref(false)
const readOnly = ref(true)

type Records = Record<string, { id: string; typeName: string; [key: string]: unknown }>
let unmount: (() => void) | undefined

onMounted(async () => {
  const id = props.drop.id
  try {
    const [{ createElement }, { createRoot }, tl, data] = await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("tldraw"),
      $fetch<{ snapshot: { schema: unknown; store: Records }; canEdit: boolean }>(`/api/drops/${id}/board`),
      import("tldraw/tldraw.css"),
    ])
    readOnly.value = !data.canEdit
    const root = createRoot(host.value!)
    root.render(
      createElement(tl.Tldraw, {
        snapshot: { document: data.snapshot } as never,
        licenseKey: config.public.tldrawLicenseKey || undefined,
        // Drop's header already names the board and holds its menu. A board has one page, the one agents read, so
        // tldraw's own menu and page picker would only repeat the header or add pages no one else sees. That leaves
        // the top-left panel with only undo, redo, delete and duplicate, which have shortcuts and sit in the context
        // menu; on narrow screens tldraw shows them above the toolbar instead, outside this panel.
        components: { MainMenu: null, PageMenu: null, MenuPanel: null },
        onMount: (editor) => {
          // In dev, the editor on window lets a browser session inspect and drive the board.
          if (import.meta.dev) Object.assign(window, { boardEditor: editor })
          unmount = sync(editor, data.snapshot.store, data.canEdit)
          state.value = "ready"
        },
      }),
    )
    const stop = unmount
    unmount = () => {
      stop?.()
      root.unmount()
    }
  } catch (error) {
    console.error(error)
    state.value = "failed"
  }
})
onBeforeUnmount(() => unmount?.())

function sync(editor: import("tldraw").Editor, initial: Records, canEdit: boolean) {
  const id = props.drop.id
  editor.updateInstanceState({ isReadonly: !canEdit })
  editor.user.updateUserPreferences({
    name: me.value?.name ?? "Guest",
    colorScheme: colorMode.value === "dark" ? "dark" : "light",
  })
  const stopTheme = watch(
    () => colorMode.value,
    (mode) => editor.user.updateUserPreferences({ colorScheme: mode === "dark" ? "dark" : "light" }),
  )
  // Who drew it: read_drop's outline says "by <name>" for every shape.
  const stopAuthor = editor.sideEffects.registerBeforeCreateHandler("shape", (shape, source) =>
    source === "user" && me.value ? { ...shape, meta: { ...shape.meta, author: me.value.name } } : shape,
  )

  // The server's records as last seen, and the changes made here that it hasn't stored yet.
  let known: Records = structuredClone(initial)
  const put = new Map<string, Records[string]>()
  const removed = new Set<string>()
  const stopListen = editor.store.listen(
    ({ changes }) => {
      for (const record of [...Object.values(changes.added), ...Object.values(changes.updated).map(([, to]) => to)]) {
        put.set(record.id, record as never)
        removed.delete(record.id)
      }
      for (const record of Object.values(changes.removed)) {
        removed.add(record.id)
        put.delete(record.id)
      }
      schedule()
    },
    { source: "user", scope: "document" },
  )

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let imageTimer: ReturnType<typeof setTimeout> | undefined
  let busy: Promise<unknown> = Promise.resolve()
  const schedule = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => (busy = busy.then(save)), 700)
  }
  async function save() {
    if (!put.size && !removed.size) return
    const body = { put: [...put.values()], remove: [...removed] }
    put.clear()
    removed.clear()
    saving.value = true
    try {
      await $fetch(`/api/drops/${id}/board`, { method: "POST", body })
      for (const record of body.put) known[record.id] = record
      for (const gone of body.remove) delete known[gone]
      clearTimeout(imageTimer)
      imageTimer = setTimeout(() => void images(), 4000)
    } catch (error) {
      // Kept for the next save, unless something newer replaced them meanwhile.
      for (const record of body.put) if (!put.has(record.id) && !removed.has(record.id)) put.set(record.id, record)
      for (const gone of body.remove) if (!put.has(gone)) removed.add(gone)
      console.error("Board save failed", error)
    } finally {
      saving.value = false
    }
  }

  // Others' and agents' changes: whatever differs from what this browser last saw, except what it is still saving.
  async function pull() {
    if (document.hidden) return
    await busy
    const data = await $fetch<{ snapshot: { store: Records } }>(`/api/drops/${id}/board`).catch(() => null)
    if (!data) return
    const remote = data.snapshot.store
    const changed = Object.values(remote).filter(
      (record) => !put.has(record.id) && JSON.stringify(record) !== JSON.stringify(known[record.id]),
    )
    const gone = Object.keys(known).filter((key) => !(key in remote) && !put.has(key))
    known = structuredClone(remote)
    if (!changed.length && !gone.length) return
    editor.store.mergeRemoteChanges(() => {
      if (gone.length) editor.store.remove(gone as never)
      if (changed.length) editor.store.put(changed as never)
    })
    await fitText(new Set(changed.map((record) => record.id)))
    // An agent's edit shows in its next view_board too.
    clearTimeout(imageTimer)
    imageTimer = setTimeout(() => void images(), 4000)
  }
  const poll = setInterval(() => void pull(), 3000)

  // tldraw fits a note or shape to its text when a person types it. Items an agent wrote on the server skipped that,
  // so long text spilled out of a fixed square: run the same fitting, then grow the agent's frames around what's in
  // them (a frame clips its contents). It measures text, and tldraw's faces arrive after the board opens (the first
  // measurement came out several lines short), so it runs again whenever the browser finishes loading fonts.
  async function fitText(only?: Set<string>) {
    await Promise.all(
      ["tldraw_draw", "tldraw_sans", "tldraw_serif", "tldraw_mono"].map((family) =>
        document.fonts.load(`16px ${family}`).catch(() => []),
      ),
    )
    const agents = editor.getCurrentPageShapes().filter((shape) => shape.meta?.agent && (!only || only.has(shape.id)))
    const fitted = agents
      .map((shape) => editor.getShapeUtil(shape).onBeforeCreate?.(shape))
      .filter((shape) => shape !== undefined)
    const apply = (updates: { id: string; type: string; props: object }[]) => {
      if (!updates.length) return
      // People who can draw store the fit, so view_board's images and other readers get it too; others fit locally.
      if (canEdit) editor.run(() => editor.updateShapes(updates as never), { history: "ignore" })
      else
        editor.store.mergeRemoteChanges(() =>
          editor.store.put(
            updates.map((update) => {
              const shape = editor.getShape(update.id as never)!
              return { ...shape, props: { ...shape.props, ...update.props } } as typeof shape
            }),
          ),
        )
    }
    apply(fitted.map(({ id, type, props }) => ({ id, type, props })))
    const frames = editor
      .getCurrentPageShapes()
      .filter((shape) => shape.type === "frame" && shape.meta?.agent) as import("tldraw").TLFrameShape[]
    apply(
      frames.flatMap((frame) => {
        const box = editor.getShapePageBounds(frame)
        const kids = editor.getSortedChildIdsForParent(frame.id).map((child) => editor.getShapePageBounds(child))
        if (!box || !kids.length) return []
        const w = Math.max(frame.props.w, ...kids.map((kid) => (kid ? kid.maxX - box.x + 40 : 0)))
        const h = Math.max(frame.props.h, ...kids.map((kid) => (kid ? kid.maxY - box.y + 40 : 0)))
        return w > frame.props.w || h > frame.props.h ? [{ id: frame.id, type: "frame", props: { w, h } }] : []
      }),
    )
  }
  const refit = () => void fitText()
  document.fonts.addEventListener("loadingdone", refit)
  // Open on the whole board, never zoomed past 100%: wide frames otherwise start off screen.
  void fitText().then(() => {
    editor.zoomToFit()
    if (editor.getZoomLevel() > 1) editor.resetZoom(editor.getViewportScreenCenter())
  })

  async function images() {
    if (!canEdit) return
    const shapes = [...editor.getCurrentPageShapeIds()]
    if (!shapes.length) return
    const toBase64 = async (blob: Blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ""
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(binary)
    }
    // At most 1600 px on the long side: readable for a model, small enough to send.
    const render = async (ids: typeof shapes) => {
      const bounds = editor.getShapesPageBounds(ids)
      const scale = bounds ? Math.min(2, 1600 / Math.max(bounds.w, bounds.h, 1)) : 1
      const { blob } = await editor.toImage(ids, { format: "png", scale, pixelRatio: 1, background: true, padding: 24 })
      return toBase64(blob)
    }
    try {
      const frames = shapes
        .map((shape) => editor.getShape(shape)!)
        .filter((shape) => shape.type === "frame" && shape.parentId === editor.getCurrentPageId())
        .slice(0, 20)
      const out = [{ frame: "overview", png: await render(shapes) }]
      for (const frame of frames) out.push({ frame: frame.id.replace(/^shape:/, ""), png: await render([frame.id]) })
      await $fetch(`/api/drops/${id}/board/images`, { method: "POST", body: { images: out } })
    } catch (error) {
      console.error("Board images failed", error)
    }
  }
  // The first person to open a board an agent made gives agents its first images.
  if (canEdit) imageTimer = setTimeout(() => void images(), 1500)

  const flush = () => void save()
  window.addEventListener("pagehide", flush)
  return () => {
    window.removeEventListener("pagehide", flush)
    document.fonts.removeEventListener("loadingdone", refit)
    clearInterval(poll)
    clearTimeout(imageTimer)
    if (put.size || removed.size) void save()
    clearTimeout(saveTimer)
    stopListen()
    stopAuthor()
    stopTheme()
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

<style scoped>
/* tldraw sizes itself to its parent and sets its own fonts; the dashboard's text styles stay outside it. */
.board :deep(.tl-container) {
  font-family: inherit;
}
</style>

<style>
/*
 * tldraw's interface in Drop's tokens (shared/theme.css, app/assets/css/main.css): the toolbar, style panel, zoom,
 * menus, popovers, dialogs and tooltips use Drop's surfaces, hairlines, text, radii and Geist, and follow `.dark` on
 * their own. Unscoped because tldraw portals its menus into its container, outside this component's elements; the
 * container's class beats tldraw's .tl-theme__light/.tl-theme__dark. The drawings keep tldraw's look: shape colors,
 * the hand-drawn font, and the blue selection and text highlight are canvas colors, not interface ones.
 */
.board .tl-container {
  /* The canvas is Drop's page. */
  --tl-color-background: var(--ui-bg);
  /* Panels and menus are popovers with a hairline, like Nuxt UI's. */
  --tl-color-panel: var(--popover);
  --tl-color-panel-contrast: var(--ui-border);
  --tl-color-panel-overlay: color-mix(in oklab, var(--popover) 82%, transparent);
  --tl-color-panel-transparent: color-mix(in oklab, var(--popover) 0%, transparent);
  --tl-color-low: var(--ui-bg-elevated);
  --tl-color-low-border: var(--ui-border);
  --tl-color-divider: var(--ui-border);
  --tl-color-text: var(--ui-text-highlighted);
  --tl-color-text-0: var(--ui-text-highlighted);
  --tl-color-text-1: var(--ui-text);
  --tl-color-text-3: var(--ui-text-muted);
  --tl-color-text-disabled: var(--ui-text-dimmed);
  /* Tooltips are inverted, as in Drop; tldraw writes their text in --tl-color-text-shadow, the page color. */
  --tl-color-tooltip: var(--ui-bg-inverted);
  --tl-color-text-shadow: var(--ui-bg);
  --tl-color-primary: var(--ui-primary);
  --tl-color-focus: var(--ring);
  --tl-color-danger: var(--ui-error);
  /* shadcn's scale from --radius: xs 4, sm 6, md 8 for controls, lg 10 for panels. */
  --tl-radius-1: calc(var(--radius) * 0.4);
  --tl-radius-2: calc(var(--radius) * 0.6);
  --tl-radius-3: calc(var(--radius) * 0.8);
  --tl-radius-4: var(--radius);
  /* Hairlines over shadows: the ring does the work, a soft shadow lifts it off the canvas. */
  --tl-shadow-1: 0 1px 2px rgb(0 0 0 / 0.05), inset 0 0 0 1px var(--ui-border);
  --tl-shadow-2: 0 1px 2px rgb(0 0 0 / 0.05), 0 4px 12px -2px rgb(0 0 0 / 0.08), inset 0 0 0 1px var(--ui-border);
  --tl-shadow-3: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1), inset 0 0 0 1px var(--ui-border);
  --tl-shadow-4: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1), inset 0 0 0 1px var(--ui-border);
}

.dark .board .tl-container {
  --tl-shadow-1: 0 1px 2px rgb(0 0 0 / 0.3), inset 0 0 0 1px var(--ui-border);
  --tl-shadow-2: 0 1px 2px rgb(0 0 0 / 0.3), 0 4px 12px -2px rgb(0 0 0 / 0.4), inset 0 0 0 1px var(--ui-border);
  --tl-shadow-3: 0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.4), inset 0 0 0 1px var(--ui-border);
  --tl-shadow-4: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5), inset 0 0 0 1px var(--ui-border);
}

/* The active tool and the opacity slider are interface, so they take Drop's primary instead of tldraw's blue. */
.board .tlui-button__tool[aria-pressed="true"],
.board .tlui-button__tool[aria-pressed="true"]:not(:disabled, [data-disabled], :focus-visible):active {
  color: var(--ui-text-inverted);
}
.board .tlui-button__tool[aria-pressed="true"]:not(:disabled, [data-disabled])::after {
  background: var(--ui-primary);
}
.board .tlui-slider__range {
  background: var(--ui-primary);
}
</style>
