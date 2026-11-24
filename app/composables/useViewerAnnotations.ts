import { promiseTimeout } from "@vueuse/core"
import type { FrameMessage } from "#shared/frame-messages"
import type { CommentInput } from "#shared/schemas"
import type { DropDetail } from "#shared/types"
import type { FrameBox } from "~/composables/useDropFrame"

type PendingComment = Omit<CommentInput, "body" | "mentions">
type Area = { ox: number; oy: number; ow: number; oh: number }
type Rect = { left: number; top: number; right: number; bottom: number }
type Selection = { quote: string; selector: string; label: string; rect: Rect }
type Lightbox = {
  src: string
  alt: string
  selector: string
  label: string
  from?: { left: number; top: number; width: number; height: number }
  at?: number
  pdfPage?: number
  file?: File
}
type Popover = { x: number; y: number } & (
  | { type: "new"; pending: PendingComment; body?: string; error?: string }
  | { type: "thread"; id: string }
)
export type ViewerTool = "browse" | "comment" | "measure" | "mark"
export type ViewerOverlays = { rulers: boolean; xray: boolean; pins: boolean }

type PointerMessage = Extract<
  FrameMessage,
  {
    type:
      | "selection"
      | "image"
      | "area"
      | "area-shot"
      | "marker"
      | "key"
      | "marks"
      | "mark-retry"
      | "draft-place"
      | "page-click"
  }
>

export function useViewerAnnotations(options: {
  drop: Ref<DropDetail>
  editing: Ref<boolean>
  enabled?: Ref<boolean>
  canvas?: Readonly<Ref<boolean>>
  reviewOpen?: Ref<boolean>
  shot?: (file: File | null) => void
  onPageClick?: () => void
}) {
  const { drop, editing } = options
  const selection = ref<Selection | null>(null)
  const lightbox = ref<Lightbox | null>(null)
  const popover = ref<Popover | null>(null)
  const draftPlace = ref<{ rail: boolean; pin?: boolean; rect: Rect } | null>(null)
  const threadPlace = ref<{ id: string; rail: boolean; rect: Rect } | null>(null)
  watch(
    () => (popover.value?.type === "thread" ? popover.value.id : null),
    (id) => threadPlace.value?.id !== id && (threadPlace.value = null),
  )
  watch(
    () => popover.value?.type === "new" && ["text", "area"].includes(popover.value.pending.kind),
    (placed) => !placed && (draftPlace.value = null),
  )
  let awaited: string | null = null
  let focusGeneration = 0
  const beginFocus = () => {
    awaited = null
    return ++focusGeneration
  }
  const isFocusCurrent = (generation: number) => generation === focusGeneration
  let awaitedShot: number | undefined
  let shotTaken = false
  let shotWaiters: (() => void)[] = []
  function settleShot() {
    awaitedShot = undefined
    for (const resolve of shotWaiters.splice(0)) resolve()
  }
  function dropShot() {
    settleShot()
    if (shotTaken) options.shot?.(null)
    shotTaken = false
  }
  function waitForShot() {
    if (awaitedShot === undefined) return Promise.resolve()
    return Promise.race([promiseTimeout(10_000), new Promise<void>((resolve) => shotWaiters.push(resolve))])
  }
  const awaitThread = (id: string | null, generation?: number) => {
    if (generation !== undefined && generation !== focusGeneration) return false
    awaited = id
    return true
  }
  const commenting = computed(() => drop.value.canComment && !editing.value && (options.enabled?.value ?? true))

  const tool = ref<ViewerTool>("browse")
  const overlays = reactive<ViewerOverlays>({ rulers: false, xray: false, pins: true })
  const areaMode = computed(() => tool.value === "comment")
  const canDrawArea = computed(
    () => commenting.value && !lightbox.value && ["markdown", "image", "html", "app"].includes(drop.value.kind),
  )
  const frameTool = computed<ViewerTool>(() =>
    canDrawArea.value && options.reviewOpen?.value && tool.value === "browse" && popover.value?.type !== "thread"
      ? "comment"
      : tool.value,
  )
  function setTool(next: ViewerTool) {
    if (!(options.enabled?.value ?? true) && next !== "browse") return
    if ((next === "comment" || next === "mark") && !canDrawArea.value) return
    if (next === "measure" && !inspectsPage.value) return
    if (options.reviewOpen && next !== "comment") options.reviewOpen.value = false
    awaited = null
    focusGeneration++
    popover.value = selection.value = null
    tool.value = tool.value === next ? "browse" : next
  }
  const toggleArea = () => setTool("comment")
  function toggleOverlay(name: keyof ViewerOverlays) {
    if (!(options.enabled?.value ?? true)) return
    if (name === "xray" && !inspectsPage.value) return
    overlays[name] = !overlays[name]
  }
  const inspectsPage = computed(() => !options.canvas?.value && ["html", "app"].includes(drop.value.kind))
  watch(
    inspectsPage,
    (available) => {
      if (available) return
      if (tool.value === "measure") tool.value = "browse"
      overlays.xray = false
    },
    { flush: "sync" },
  )
  watch(canDrawArea, (value) => !value && ["comment", "mark"].includes(tool.value) && (tool.value = "browse"))
  watch(
    () => popover.value?.type === "new",
    (writing) => !writing && dropShot(),
  )

  const pen = reactive<MarkPen>({ tip: "marker", color: "pink", sizes: { marker: 1, pen: 1, arrow: 1, text: 1 } })
  const penStyle = computed(() => ({
    tool: pen.tip,
    color: MARK_COLORS[pen.color],
    width: MARK_TIPS[pen.tip].sizes[pen.sizes[pen.tip]]!,
  }))
  const marks = ref(0)
  const finishing = ref(false)
  watch(tool, (value) => value !== "mark" && (finishing.value = false))
  function mark(tip: MarkTip = pen.tip) {
    pen.tip = tip
    if (tool.value !== "mark") setTool("mark")
  }
  function resize(step: number) {
    const sizes = MARK_TIPS[pen.tip].sizes
    pen.sizes[pen.tip] = Math.min(sizes.length - 1, Math.max(0, pen.sizes[pen.tip] + step))
  }
  const draftingArea = computed(
    () =>
      (options.reviewOpen?.value ?? true) &&
      popover.value?.type === "new" &&
      ["area", "image"].includes(popover.value.pending.kind),
  )

  function dismiss() {
    const waiting = awaited !== null
    awaited = null
    focusGeneration++
    if (waiting || popover.value || selection.value) popover.value = selection.value = null
    else tool.value = "browse"
  }

  function receive(message: PointerMessage, frame: FrameBox) {
    const x = (value: number) => frame.left + value * frame.scale
    const y = (value: number) => frame.top + value * frame.scale
    if (message.type === "marker" && message.focused && message.id !== awaited) return
    if (message.type === "marker" || message.type === "area" || message.type === "image") {
      awaited = null
      focusGeneration++
    }
    if (message.type === "selection" && commenting.value) {
      selection.value = message.clear
        ? null
        : {
            quote: message.quote,
            selector: message.selector,
            label: message.label,
            rect: {
              left: x(message.rect.left),
              top: y(message.rect.top),
              right: x(message.rect.right),
              bottom: y(message.rect.bottom),
            },
          }
    }
    if (message.type === "image") {
      const from = message.rect && {
        left: x(message.rect.left),
        top: y(message.rect.top),
        width: (message.rect.right - message.rect.left) * frame.scale,
        height: (message.rect.bottom - message.rect.top) * frame.scale,
      }
      lightbox.value = { src: message.src, alt: message.alt, selector: message.selector, label: message.label, from }
    }
    if (message.type === "marks") marks.value = message.count
    if (message.type === "mark-retry") finishing.value = false
    if (message.type === "page-click") options.onPageClick?.()
    if (message.type === "draft-place") {
      const rect = {
        left: x(message.rect.left),
        top: y(message.rect.top),
        right: x(message.rect.right),
        bottom: y(message.rect.bottom),
      }
      if (message.id) {
        if (popover.value?.type === "thread" && popover.value.id === message.id)
          threadPlace.value = { id: message.id, rail: message.rail, rect }
      } else if (popover.value?.type === "new") draftPlace.value = { rail: message.rail, pin: message.pin, rect }
    }
    if (message.type === "area") {
      dropShot()
      awaitedShot = commenting.value ? message.shot : undefined
      const marked = tool.value === "mark"
      if (marked) tool.value = "browse"
      if (commenting.value) {
        const { kind = "area", selector, label, ox, oy, ow, oh, quote, ink } = message
        draftPlace.value = null
        popover.value = {
          type: "new",
          pending: {
            kind,
            selector,
            label,
            ox,
            oy,
            ow,
            oh,
            ...(marked && quote ? { quote } : {}),
            ...(marked && ink ? { ink } : {}),
          },
          x: x(message.rect.left),
          y: y(message.rect.bottom),
        }
      }
    }
    if (message.type === "area-shot" && message.shot === awaitedShot && popover.value?.type === "new") {
      const { image } = message
      if (image) {
        const type = image.type || "image/png"
        options.shot?.(new File([image], `screenshot.${type.split("/")[1]}`, { type }))
        shotTaken = true
      }
      settleShot()
    }
    if (message.type === "marker")
      popover.value = {
        type: "thread",
        id: message.id,
        x: x(message.clientX),
        y: y(message.clientY),
      }
    if (message.type === "key") pressed(message.key, message.tool)
  }

  function pressed(key: Extract<PointerMessage, { type: "key" }>["key"], under?: ViewerTool) {
    if (key === "Escape") {
      if (!options.reviewOpen?.value) return dismiss()
      options.reviewOpen.value = false
      tool.value = "browse"
      selection.value = null
      beginFocus()
      return
    }
    if (key === "c" || key === "e") return commentOnSelection(key === "e")
    if (drop.value.kind === "app" && (under ?? "browse") === "browse") return
    if (key === "v") setTool("browse")
    if (key === "r") setTool("comment")
    if (key === "s") setTool("measure")
    if (key === "u") toggleOverlay("rulers")
    if (key === "x") toggleOverlay("xray")
    if (key === "b") mark("marker")
    if (key === "p") mark("pen")
    if (key === "a") mark("arrow")
    if (key === "t") mark("text")
    if (key === "[" && tool.value === "mark") resize(-1)
    if (key === "]" && tool.value === "mark") resize(1)
  }

  function commentOnSelection(suggest = false) {
    if (!selection.value) return
    const { selector, quote, label, rect } = selection.value
    popover.value = {
      type: "new",
      pending: {
        kind: "text",
        selector,
        ox: 0,
        oy: 0,
        ow: 0,
        oh: 0,
        quote,
        label,
        ...(suggest ? { suggestion: quote } : {}),
      },
      x: rect.left,
      y: rect.bottom,
    }
    selection.value = null
  }

  function pickImage(area: Area, x: number, y: number) {
    if (!lightbox.value || !commenting.value) return
    const { selector, alt, label, at, pdfPage, file } = lightbox.value
    popover.value = {
      type: "new",
      pending:
        at !== undefined
          ? { kind: "image", selector, ...area, label, at }
          : pdfPage !== undefined
            ? { kind: "image", selector, ...area, label, pdfPage }
            : { kind: "image", selector, ...area, label: alt || "image" },
      x,
      y,
    }
    if (!file) return
    dropShot()
    options.shot?.(file)
    shotTaken = true
  }
  const imageDraft = computed(() =>
    (options.reviewOpen?.value ?? true) &&
    popover.value?.type === "new" &&
    popover.value.pending.kind === "image" &&
    popover.value.pending.ow
      ? popover.value.pending
      : undefined,
  )

  return {
    selection,
    lightbox,
    popover,
    draftPlace,
    threadPlace,
    tool,
    frameTool,
    overlays,
    areaMode,
    canDrawArea,
    draftingArea,
    imageDraft,
    toggleArea,
    setTool,
    toggleOverlay,
    pen,
    penStyle,
    marks,
    finishing,
    mark,
    resize,
    dismiss,
    awaitThread,
    beginFocus,
    isFocusCurrent,
    receive,
    commentOnSelection,
    pickImage,
    waitForShot,
  }
}
