import type { FrameMessage } from "#shared/frame-messages"
import type { DropDetail } from "#shared/types"
import type { PendingComment } from "~/components/viewer/ViewerCommentPopover.vue"
import type { Area } from "~/components/viewer/ViewerLightbox.vue"

type Rect = { left: number; top: number; right: number; bottom: number }
type Selection = { quote: string; selector: string; label: string; rect: Rect }
type Lightbox = { src: string; alt: string; selector: string; label: string; from?: { left: number; top: number; width: number; height: number } }
type Popover = { x: number; y: number } & ({ type: "new"; pending: PendingComment } | { type: "thread"; id: string })

/** What the frame reports about the reader's pointer and keys, in frame coordinates. */
type PointerMessage = Extract<FrameMessage, { type: "selection" | "image" | "area" | "marker" | "key" }>

/**
 * What the reader points at in the viewer: a text selection with its Comment button, an image zoomed in the lightbox,
 * area mode's crosshair, and the popover where a new comment is written or a thread read. The frame's reports
 * (`receive`) arrive with the frame's box, to turn their coordinates into the page's.
 */
export function useViewerAnnotations(options: { drop: Ref<DropDetail>; editing: Ref<boolean>; wide: Ref<boolean>; mobileSide: Ref<boolean> }) {
  const { drop, editing } = options
  const selection = ref<Selection | null>(null)
  const lightbox = ref<Lightbox | null>(null)
  const popover = ref<Popover | null>(null)
  const commenting = computed(() => drop.value.canComment && !editing.value)

  /** Area mode: the frame lays a crosshair over the page, and the next rectangle drawn there becomes a comment. */
  const areaMode = ref(false)
  // TODO(file-comments): files without a preview (PDFs, zips) have nothing to anchor a comment to, so they take none yet.
  // Comments on the file as a whole would close that gap.
  // A site takes its comments on the site itself (ViewerSite).
  const canDrawArea = computed(() => commenting.value && !lightbox.value && drop.value.kind !== "file" && drop.value.kind !== "folder" && drop.value.kind !== "site")
  function toggleArea() {
    if (!canDrawArea.value) return
    popover.value = selection.value = null
    areaMode.value = !areaMode.value
    if (areaMode.value && !options.wide.value) options.mobileSide.value = false
  }
  watch(canDrawArea, value => !value && (areaMode.value = false))
  // The frame keeps the drawn rectangle while its comment is written; it drops it once the popover goes.
  const draftingArea = computed(() => popover.value?.type === "new" && popover.value.pending.kind === "area")

  /** Escape: close whatever is open. */
  function dismiss() {
    popover.value = selection.value = null
    areaMode.value = false
  }

  function receive(message: PointerMessage, frame: DOMRect) {
    if (message.type === "selection" && commenting.value) {
      selection.value = message.clear ? null : {
        quote: message.quote, selector: message.selector, label: message.label,
        rect: { left: frame.left + message.rect.left, top: frame.top + message.rect.top, right: frame.left + message.rect.right, bottom: frame.top + message.rect.bottom },
      }
    }
    if (message.type === "image") {
      const from = message.rect && { left: frame.left + message.rect.left, top: frame.top + message.rect.top, width: message.rect.right - message.rect.left, height: message.rect.bottom - message.rect.top }
      areaMode.value = false
      lightbox.value = { src: message.src, alt: message.alt, selector: message.selector, label: message.label, from }
    }
    if (message.type === "area") {
      areaMode.value = false
      if (commenting.value) {
        const { selector, label, ox, oy, ow, oh } = message
        popover.value = { type: "new", pending: { kind: "area", selector, label, ox, oy, ow, oh }, x: frame.left + message.rect.left, y: frame.top + message.rect.bottom }
      }
    }
    if (message.type === "marker") popover.value = { type: "thread", id: message.id, x: frame.left + message.clientX, y: frame.top + message.clientY }
    if (message.type === "key" && message.key === "Escape") dismiss()
    // Apps may use R themselves, so only docs forward it.
    if (message.type === "key" && message.key === "r" && drop.value.kind !== "app") toggleArea()
  }

  function commentOnSelection() {
    if (!selection.value) return
    const { selector, quote, label, rect } = selection.value
    popover.value = { type: "new", pending: { kind: "text", selector, ox: 0, oy: 0, ow: 0, oh: 0, quote, label }, x: rect.left, y: rect.bottom }
    selection.value = null
  }

  // Areas drawn over an image in the page anchor to that image, so the lightbox takes comments too.
  function pickImage(area: Area, x: number, y: number) {
    if (!lightbox.value) return
    popover.value = { type: "new", pending: { kind: "image", selector: lightbox.value.selector, ...area, label: lightbox.value.alt || "image" }, x, y }
  }
  const imageDraft = computed(() => (popover.value?.type === "new" && popover.value.pending.kind === "image" && popover.value.pending.ow ? popover.value.pending : undefined))

  return { selection, lightbox, popover, areaMode, canDrawArea, draftingArea, imageDraft, toggleArea, dismiss, receive, commentOnSelection, pickImage }
}
