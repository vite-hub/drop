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
/** The toolbar's tools (ViewerToolbar): the page as it is, the Comment tool, or the Measure tool. */
export type ViewerTool = "browse" | "comment" | "measure"
/** What the toolbar shows over the page under any tool. */
export type ViewerOverlays = { rulers: boolean; xray: boolean; pins: boolean }

/** What the frame reports about the reader's pointer and keys, in frame coordinates. */
type PointerMessage = Extract<FrameMessage, { type: "selection" | "image" | "area" | "marker" | "key" }>

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
}) {
  const { drop, editing } = options
  const selection = ref<Selection | null>(null)
  const lightbox = ref<Lightbox | null>(null)
  const popover = ref<Popover | null>(null)
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
  /** Picks a tool, or puts the one on back to Browse. */
  function setTool(next: ViewerTool) {
    if (!(options.enabled?.value ?? true) && next !== "browse") return
    if (next === "comment" && !canDrawArea.value) return
    if (next === "measure" && !["html", "app"].includes(drop.value.kind)) return
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
  watch(canDrawArea, (value) => !value && tool.value === "comment" && (tool.value = "browse"))
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
    if (message.type === "area") {
      if (commenting.value) {
        const { kind = "area", selector, label, ox, oy, ow, oh } = message
        popover.value = {
          type: "new",
          pending: { kind, selector, label, ox, oy, ow, oh },
          x: x(message.rect.left),
          y: y(message.rect.bottom),
        }
      }
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
    if (key === "Escape") return dismiss()
    if (drop.value.kind === "app" && (under ?? "browse") === "browse") return
    if (key === "v") tool.value = "browse"
    if (key === "r") setTool("comment")
    if (key === "s") setTool("measure")
    if (key === "u") toggleOverlay("rulers")
    if (key === "x") toggleOverlay("xray")
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
    tool,
    overlays,
    areaMode,
    canDrawArea,
    draftingArea,
    imageDraft,
    toggleArea,
    setTool,
    toggleOverlay,
    dismiss,
    awaitThread,
    beginFocus,
    isFocusCurrent,
    receive,
    commentOnSelection,
    pickImage,
  }
}
