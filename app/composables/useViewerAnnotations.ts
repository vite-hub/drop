import type { FrameMessage } from "#shared/frame-messages"
import type { CommentInput } from "#shared/schemas"
import type { DropDetail } from "#shared/types"
import type { FrameBox } from "~/composables/useDropFrame"

// Spelled out here rather than imported from the popover and lightbox SFCs, whose types ESLint can't read.
type PendingComment = Omit<CommentInput, "body">
type Area = { ox: number; oy: number; ow: number; oh: number }
type Rect = { left: number; top: number; right: number; bottom: number }
type Selection = { quote: string; selector: string; label: string; rect: Rect }
type Lightbox = {
  src: string
  alt: string
  selector: string
  label: string
  from?: { left: number; top: number; width: number; height: number }
}
// `body` and `error`: a comment that didn't go through, back in its box with why.
type Popover = { x: number; y: number } & (
  | { type: "new"; pending: PendingComment; body?: string; error?: string }
  | { type: "thread"; id: string }
)
/** The toolbar's tools (ViewerToolbar): the page as it is, the Comment tool, the Measure tool, or the Marker. */
export type ViewerTool = "browse" | "comment" | "measure" | "mark"
/** What the toolbar shows over the page under any tool. */
export type ViewerOverlays = { rulers: boolean; xray: boolean; pins: boolean }

/** What the frame reports about the reader's pointer and keys, in frame coordinates. */
type PointerMessage = Extract<
  FrameMessage,
  { type: "selection" | "image" | "area" | "area-shot" | "marker" | "key" | "marks" | "draft-place" }
>

/**
 * What the reader points at in the viewer: a text selection with its Comment button, an image zoomed in the lightbox,
 * the toolbar's tools and overlays, and the popover where a new comment is written or a thread read. The frame's reports
 * (`receive`) arrive with the frame's box, to turn their coordinates into the page's.
 */
export function useViewerAnnotations(options: {
  drop: Ref<DropDetail>
  editing: Ref<boolean>
  enabled?: Ref<boolean>
  reviewOpen?: Ref<boolean>
  /**
   * The frame's picture of the tooltip or menu the comment being written is on, for its images; null once that comment
   * is on another area, sent, or put away, so its picture goes too.
   */
  shot?: (file: File | null) => void
}) {
  const { drop, editing } = options
  const selection = ref<Selection | null>(null)
  const lightbox = ref<Lightbox | null>(null)
  const popover = ref<Popover | null>(null)
  /** Where the frame keeps the place of the comment being written on a selection, in page coordinates (draft-place). */
  const draftPlace = ref<{ rail: boolean; rect: Rect } | null>(null)
  watch(
    () => popover.value?.type === "new" && popover.value.pending.kind === "text",
    (text) => !text && (draftPlace.value = null),
  )
  /**
   * The comment whose thread the frame will open once it has scrolled to the pin (`awaitThread`). Escape, a tool, or
   * another comment in the meantime clears it, so the late report doesn't open a thread the reader moved on from.
   */
  let awaited: string | null = null
  let focusGeneration = 0
  const beginFocus = () => {
    awaited = null
    return ++focusGeneration
  }
  const isFocusCurrent = (generation: number) => generation === focusGeneration
  /** The number of the picture the frame takes for the area being commented on, if it takes one. */
  let awaitedShot: number | undefined
  let shotTaken = false
  let shotWaiters: (() => void)[] = []
  function settleShot() {
    awaitedShot = undefined
    for (const resolve of shotWaiters.splice(0)) resolve()
  }
  /** Drops the picture of the area that was being commented on, and stops waiting for one. */
  function dropShot() {
    settleShot()
    if (shotTaken) options.shot?.(null)
    shotTaken = false
  }
  /** Resolves once the picture for the area being commented on is in, or failed, or after 10 s: a big page takes 5. */
  function waitForShot() {
    if (awaitedShot === undefined) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10_000)
      shotWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  const awaitThread = (id: string | null, generation?: number) => {
    if (generation !== undefined && generation !== focusGeneration) return false
    awaited = id
    return true
  }
  const commenting = computed(() => drop.value.canComment && !editing.value && (options.enabled?.value ?? true))

  /**
   * Under Comment and Measure the frame lays a layer over the page that takes the pointer. Comment stays on after each
   * comment, so a review drops one pin after another; Escape or Browse (V) gives the page its clicks back.
   */
  const tool = ref<ViewerTool>("browse")
  const overlays = reactive<ViewerOverlays>({ rulers: false, xray: false, pins: true })
  const areaMode = computed(() => tool.value === "comment")
  // Boards and files take general feedback; sites annotate captured screenshots through ViewerSite.
  const canDrawArea = computed(
    () => commenting.value && !lightbox.value && ["markdown", "image", "html", "app"].includes(drop.value.kind),
  )
  // Opening Comments makes dragging available without replacing the plain-comment composer.
  const frameTool = computed<ViewerTool>(() =>
    canDrawArea.value && options.reviewOpen?.value && tool.value === "browse" && popover.value?.type !== "thread"
      ? "comment"
      : tool.value,
  )
  /** Picks a tool, or puts the one on back to Browse. */
  function setTool(next: ViewerTool) {
    if (!(options.enabled?.value ?? true) && next !== "browse") return
    if ((next === "comment" || next === "mark") && !canDrawArea.value) return
    if (next === "measure" && !["html", "app"].includes(drop.value.kind)) return
    if (options.reviewOpen && next !== "comment") options.reviewOpen.value = false
    awaited = null
    focusGeneration++
    popover.value = selection.value = null
    tool.value = tool.value === next ? "browse" : next
  }
  const toggleArea = () => setTool("comment")
  function toggleOverlay(name: keyof ViewerOverlays) {
    if (!(options.enabled?.value ?? true)) return
    if (name !== "pins" && !["html", "app"].includes(drop.value.kind)) return
    overlays[name] = !overlays[name]
  }
  watch(canDrawArea, (value) => !value && ["comment", "mark"].includes(tool.value) && (tool.value = "browse"))
  // A new comment that's sent, put away, or turned into a thread no longer wants the picture of its area.
  watch(
    () => popover.value?.type === "new",
    (writing) => !writing && dropShot(),
  )

  /**
   * The Marker freezes the page in the frame and takes strokes on it until Done sends them as one area comment with the
   * snapshot (shared/plan-runtime.ts). `marks` counts the strokes so far; `finishing` holds while the frame draws them
   * onto the snapshot.
   */
  const pen = reactive<MarkPen>({ tip: "marker", color: "pink", sizes: { marker: 1, pen: 1, arrow: 1 } })
  const penStyle = computed(() => ({
    tool: pen.tip,
    color: MARK_COLORS[pen.color],
    width: MARK_TIPS[pen.tip].sizes[pen.sizes[pen.tip]]!,
  }))
  const marks = ref(0)
  const finishing = ref(false)
  watch(tool, (value) => value !== "mark" && (finishing.value = false))
  /** Takes up the Marker with `tip`, or switches to it while marking. */
  function mark(tip: MarkTip = pen.tip) {
    pen.tip = tip
    if (tool.value !== "mark") setTool("mark")
  }
  function resize(step: number) {
    const sizes = MARK_TIPS[pen.tip].sizes
    pen.sizes[pen.tip] = Math.min(sizes.length - 1, Math.max(0, pen.sizes[pen.tip] + step))
  }
  // The frame keeps the drawn rectangle while its comment is written, on the page or a zoomed screenshot; it drops it
  // once the review dock closes. The mounted composer keeps its unsent text and files.
  const draftingArea = computed(
    () =>
      (options.reviewOpen?.value ?? true) &&
      popover.value?.type === "new" &&
      ["area", "image"].includes(popover.value.pending.kind),
  )

  /** Escape: close whatever is open, then put the tool down. */
  function dismiss() {
    const waiting = awaited !== null
    awaited = null
    focusGeneration++
    if (waiting || popover.value || selection.value) popover.value = selection.value = null
    else tool.value = "browse"
  }

  function receive(message: PointerMessage, frame: FrameBox) {
    // Frame coordinates to page ones: the frame may be scaled down to fit a device's size.
    const x = (value: number) => frame.left + value * frame.scale
    const y = (value: number) => frame.top + value * frame.scale
    if (message.type === "marker" && message.focused && message.id !== awaited) return
    // A pin, an area or an image picked meanwhile is the reader moving on.
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
    if (message.type === "draft-place" && popover.value?.type === "new")
      draftPlace.value = {
        rail: message.rail,
        rect: {
          left: x(message.rect.left),
          top: y(message.rect.top),
          right: x(message.rect.right),
          bottom: y(message.rect.bottom),
        },
      }
    if (message.type === "area") {
      dropShot()
      awaitedShot = commenting.value ? message.shot : undefined
      // A Marker snapshot is one comment: the page unfreezes, and the strokes stay on it while it's written.
      const marked = tool.value === "mark"
      if (marked) tool.value = "browse"
      if (commenting.value) {
        const { kind = "area", selector, label, ox, oy, ow, oh, quote } = message
        popover.value = {
          type: "new",
          pending: { kind, selector, label, ox, oy, ow, oh, ...(marked && quote ? { quote } : {}) },
          x: x(message.rect.left),
          y: y(message.rect.bottom),
        }
      }
    }
    // Only for the comment it was taken for, while it's still being written.
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

  /** A toolbar key pressed while the page had focus. Apps may use these keys themselves, so only under a tool there. */
  function pressed(key: Extract<PointerMessage, { type: "key" }>["key"], under?: ViewerTool) {
    if (key === "Escape") {
      if (!options.reviewOpen?.value) return dismiss()
      options.reviewOpen.value = false
      tool.value = "browse"
      selection.value = null
      beginFocus()
      return
    }
    if (drop.value.kind === "app" && (under ?? "browse") === "browse") return
    if (key === "v") setTool("browse")
    if (key === "r") setTool("comment")
    if (key === "s") setTool("measure")
    if (key === "u") toggleOverlay("rulers")
    if (key === "x") toggleOverlay("xray")
    if (key === "b") mark("marker")
    if (key === "p") mark("pen")
    if (key === "a") mark("arrow")
    if (key === "[" && tool.value === "mark") resize(-1)
    if (key === "]" && tool.value === "mark") resize(1)
  }

  function commentOnSelection() {
    if (!selection.value) return
    const { selector, quote, label, rect } = selection.value
    popover.value = {
      type: "new",
      pending: { kind: "text", selector, ox: 0, oy: 0, ow: 0, oh: 0, quote, label },
      x: rect.left,
      y: rect.bottom,
    }
    selection.value = null
  }

  // Areas drawn over an image in the page anchor to that image, so the lightbox takes comments too.
  function pickImage(area: Area, x: number, y: number) {
    if (!lightbox.value || !commenting.value) return
    popover.value = {
      type: "new",
      pending: { kind: "image", selector: lightbox.value.selector, ...area, label: lightbox.value.alt || "image" },
      x,
      y,
    }
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
