import type { FrameMessage } from "#shared/frame-messages"
import type { CommentInput } from "#shared/schemas"
import type { DropDetail } from "#shared/types"

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
  wide: Ref<boolean>
  mobileSide: Ref<boolean>
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
  const awaitThread = (id: string | null) => (awaited = id)
  const commenting = computed(() => drop.value.canComment && !editing.value)

  /**
   * Under Comment and Measure the frame lays a layer over the page that takes the pointer. Comment stays on after each
   * comment, so a review drops one pin after another; Escape or Browse (V) gives the page its clicks back.
   */
  const tool = ref<ViewerTool>("browse")
  const overlays = reactive<ViewerOverlays>({ rulers: false, xray: false, pins: true })
  const areaMode = computed(() => tool.value === "comment")
  // TODO(file-comments): files without a preview (PDFs, zips) have nothing to anchor a comment to, so they take none yet.
  // Comments on the file as a whole would close that gap.
  // A site takes its comments on the site itself (ViewerSite).
  const canDrawArea = computed(
    () =>
      commenting.value &&
      !lightbox.value &&
      drop.value.kind !== "file" &&
      drop.value.kind !== "folder" &&
      drop.value.kind !== "site",
  )
  /** Picks a tool, or puts the one on back to Browse. */
  function setTool(next: ViewerTool) {
    if (next === "comment" && !canDrawArea.value) return
    awaited = null
    popover.value = selection.value = null
    tool.value = tool.value === next ? "browse" : next
    if (tool.value !== "browse" && !options.wide.value) options.mobileSide.value = false
  }
  const toggleArea = () => setTool("comment")
  const toggleOverlay = (name: keyof ViewerOverlays) => (overlays[name] = !overlays[name])
  watch(canDrawArea, (value) => !value && tool.value === "comment" && (tool.value = "browse"))
  // The frame keeps the drawn rectangle while its comment is written, on the page or a zoomed screenshot; it drops it
  // once the popover goes.
  const draftingArea = computed(
    () => popover.value?.type === "new" && ["area", "image"].includes(popover.value.pending.kind),
  )

  /** Escape: close whatever is open, then put the tool down. */
  function dismiss() {
    const waiting = awaited !== null
    awaited = null
    if (waiting || popover.value || selection.value) popover.value = selection.value = null
    else tool.value = "browse"
  }

  function receive(message: PointerMessage, frame: DOMRect) {
    if (message.type === "marker" && message.focused && message.id !== awaited) return
    // A pin, an area or an image picked meanwhile is the reader moving on.
    if (message.type === "marker" || message.type === "area" || message.type === "image") awaited = null
    if (message.type === "selection" && commenting.value) {
      selection.value = message.clear
        ? null
        : {
            quote: message.quote,
            selector: message.selector,
            label: message.label,
            rect: {
              left: frame.left + message.rect.left,
              top: frame.top + message.rect.top,
              right: frame.left + message.rect.right,
              bottom: frame.top + message.rect.bottom,
            },
          }
    }
    if (message.type === "image") {
      const from = message.rect && {
        left: frame.left + message.rect.left,
        top: frame.top + message.rect.top,
        width: message.rect.right - message.rect.left,
        height: message.rect.bottom - message.rect.top,
      }
      lightbox.value = { src: message.src, alt: message.alt, selector: message.selector, label: message.label, from }
    }
    if (message.type === "area") {
      if (commenting.value) {
        const { kind = "area", selector, label, ox, oy, ow, oh } = message
        popover.value = {
          type: "new",
          pending: { kind, selector, label, ox, oy, ow, oh },
          x: frame.left + message.rect.left,
          y: frame.top + message.rect.bottom,
        }
      }
    }
    if (message.type === "marker")
      popover.value = {
        type: "thread",
        id: message.id,
        x: frame.left + message.clientX,
        y: frame.top + message.clientY,
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
    if (!lightbox.value) return
    popover.value = {
      type: "new",
      pending: { kind: "image", selector: lightbox.value.selector, ...area, label: lightbox.value.alt || "image" },
      x,
      y,
    }
  }
  const imageDraft = computed(() =>
    popover.value?.type === "new" && popover.value.pending.kind === "image" && popover.value.pending.ow
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
    receive,
    commentOnSelection,
    pickImage,
  }
}
