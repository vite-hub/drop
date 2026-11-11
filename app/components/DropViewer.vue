<script setup lang="ts">
// The header locates the drop; the bottom review pill owns editing, comments, sharing, Details, and History.
// Frame annotations open their composer or thread in the same review dock.
import type { DocWidth } from "#shared/documents"
import type { DetailsAction } from "~/components/viewer/ViewerDetailsSegment.vue"
import { breakpointsTailwind } from "@vueuse/core"
import type { CommentStyle } from "~/composables/usePreferences"
import { expiryLabel } from "#shared/expiry"
import { dropPath } from "#shared/links"
import { videoType } from "#shared/plans"
import { isPreviewLink, resourceLabel } from "#shared/resources"
import { SHARE_ICONS } from "#shared/share"
import type { CommandPaletteItem } from "@nuxt/ui"
import type { DropComment, DropVersion, SiteReviewItem } from "#shared/types"
import { AvatarStack } from "vite-hub/ui/avatar-stack"
import { ConnectionStatus, ConnectionStatusLabel, type ConnectionStatusState } from "vite-hub/ui/connection-status"
// The parts' one stylesheet: comments, presence, and the editor's carets.
import "vite-hub/ui/styles.css"

const { publicView = false } = defineProps<{ publicView?: boolean }>()

const state = injectDrop()!
const drop = computed(() => state.drop.data.value!)
const comments = computed(() => state.comments.data.value)

// Site reviews attach screenshots to the same comment threads. Fetch the thumbnails once for list and thread.
const siteReview =
  drop.value.kind === "site"
    ? useApi<SiteReviewItem[]>(() => `/api/drops/${drop.value.id}/review`, {
        key: () => keys.review(drop.value.id),
        default: () => [],
      })
    : undefined
const screenshots = computed(() => new Map((siteReview?.data.value ?? []).map((item) => [item.id, item.screenshot])))

const route = useRoute()
const notify = useNotify()
const { copy, copyLoading, copied } = useCopy()
const { remove, restore } = useDropActions()
const [DefineDetails, ReuseDetails] = createReusableTemplate()
const [DefineHistory, ReuseHistory] = createReusableTemplate()
const [DefineComposer, ReuseComposer] = createReusableTemplate()
const { width: windowWidth, height: windowHeight } = useWindowSize()

const isApp = computed(() => drop.value.kind === "app")
const video = computed(() => (drop.value.kind === "file" ? videoType(drop.value.filename) : undefined))
// The owner gets their controls on the public link too: it is where they land after sharing it.
const owner = computed(() => drop.value.isOwner)
// Signed-in people read a public link inside the app, sidebar included (pages/d/[id]/[[slug]].vue); visitors see it alone.
const { data: me } = useMe()
const visitor = computed(() => publicView && !me.value)
const openCount = computed(() => comments.value.filter((comment) => !comment.resolved).length)
const link = useShareUrl(drop)
const now = useRelativeNow()
const trashed = computed(() => drop.value.trashedAt !== null)
// A doc's link opens its latest version. Someone reading an earlier one, pinned (`?v=`) or from History, can go to the
// latest; someone whose old link moved them to the latest (`?from=`) can go back to the version they were sent.
const latest = computed(() => drop.value.versions[0] ?? drop.value)
const older = computed(() => latest.value.version !== drop.value.version)
const latestTo = computed(() => (publicView ? dropPath(drop.value) : `/drops/${drop.value.id}`))
const sentVersion = computed(() => {
  const version = Number(route.query.from)
  return publicView && !older.value && version > 0 && version < drop.value.version ? version : 0
})
const sentNotice = ref(true)
const restoring = ref(false)
async function restoreDrop() {
  restoring.value = true
  await restore(drop.value)
  restoring.value = false
}

// Wide screens float a new comment's card over the page; narrower ones write it in the dock.
const breakpoints = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 })
const wide = breakpoints.greaterOrEqual("lg")
const phone = breakpoints.smaller("sm")
/**
 * The drop's details and actions, in a segment that grows inside the review pill (ViewerDetailsSegment): ⓘ or I opens
 * it, and `detailsPop` is the popover open from it, the details or History.
 */
const detailsOpen = ref(false)
const detailsPop = ref<"meta" | "history" | null>(null)
const hasHistory = computed(() => drop.value.versions.length > 1)
function showDetails(pop: "meta" | "history" | null = null) {
  if (editing.value) return
  detailsOpen.value = true
  detailsPop.value = pop
}
// Share, a segment popover, and Comments would stack over each other: opening one closes the others. An Escape that
// just closed the popover (Reka hears it first) leaves the segment open: the next one folds it.
let detailsPopClosedAt = 0
watch(
  detailsPop,
  (value, before) => {
    if (value) {
      shareOpen.value = false
      if (commentsOpen.value) closeComments()
    } else if (before) detailsPopClosedAt = performance.now()
  },
  { flush: "sync" },
)
const hasComments = computed(() => drop.value.kind !== "folder")
const commentsOpen = ref(false)
const reviewDraft = provideReviewDraft()
const siteRef = useTemplateRef<{
  canDraw: boolean
  capturing: boolean
  pending: boolean
}>("siteRef")
const commentsRef = useTemplateRef<{ focusComposer: () => void; focusComment: (id: string) => void }>("commentsRef")
const reviewDock = useTemplateRef<{ focusTrigger: () => void; top: number }>("reviewDock")
function showComments() {
  if (!hasComments.value || editing.value) return
  shareOpen.value = false
  tool.value = "browse"
  commentsOpen.value = true
  detailsPop.value = null
}
function closeComments() {
  commentsOpen.value = false
  tool.value = "browse"
  annotations.beginFocus()
  selection.value = null
  reviewDock.value?.focusTrigger()
}
function toggleComments() {
  if (commentsOpen.value) closeComments()
  else showComments()
}
/**
 * Comments as a mode (ViewerCommentsSegment): while it's on, a click or a drag on the page comments on that spot, and
 * the dock's panel opens only for the list or a comment on the whole page. One of the pill's segments shows at a time:
 * turning this on folds Details, and opening Details turns this off.
 */
const commentMode = ref(false)
function toggleCommentMode() {
  if (!hasComments.value || editing.value || trashed.value) return
  if (!canUseCommentMode.value) return toggleComments()
  commentMode.value = !commentMode.value
}
watch(commentMode, (on) => {
  if (on) {
    detailsOpen.value = false
    shareOpen.value = false
    tool.value = "browse"
  } else if (commentsOpen.value) closeComments()
})
watch(detailsOpen, (open) => open && (commentMode.value = false))
async function commentOnPage() {
  popover.value = null
  showComments()
  await nextTick()
  commentsRef.value?.focusComposer()
}
async function backToComments() {
  const selected = popover.value?.type === "thread" ? popover.value.id : undefined
  popover.value = null
  await nextTick()
  if (selected) commentsRef.value?.focusComment(selected)
  else commentsRef.value?.focusComposer()
}
const app = useAppFiles(drop)
const { pages, page, location: appAt } = app

const live = useLiveEditor(drop, { publicView: publicView })
const editing = live.editing
// ConnectionStatus waits 1.5 s before it says Reconnecting: a dropped socket usually comes back sooner, and Yjs keeps
// the edits meanwhile.
const liveLabels = { connecting: "Connecting", connected: "Live", reconnecting: "Reconnecting" } as const
const liveLabel = (status: ConnectionStatusState) =>
  live.publishing.value && status === "connected" ? "Publishing" : liveLabels[status]

const annotationsEnabled = computed(() => !route.query.changes && !trashed.value)
/** The picture the frame took of the tooltip or menu the new comment is on, among the draft's images. */
let autoShot: File | null = null
const annotations = useViewerAnnotations({
  drop,
  editing,
  enabled: annotationsEnabled,
  // The page takes clicks for comments while the mode is on or the dock's panel is open; putting them away ends both.
  reviewOpen: computed({
    get: () => commentMode.value || commentsOpen.value,
    set: (value: boolean) => {
      if (value) return
      commentMode.value = false
      commentsOpen.value = false
    },
  }),
  shot: (file) => {
    const { images } = reviewDraft
    const before = images.picks.value.find((pick) => pick.file === autoShot)
    if (before) images.remove(before)
    // A send under way clears the draft when it's done, but not one that changed meanwhile: the picture would stay.
    autoShot = file && !reviewDraft.sending.value ? file : null
    if (autoShot) images.add([autoShot])
  },
  // Pin style: a click on the page puts away the thread beside a pin, or a composer with nothing typed in it.
  onPageClick: () => {
    if (pinThread.value) popover.value = null
    else if (pinDraft.value && !reviewDraft.body.value.trim()) popover.value = null
  },
})
const {
  selection,
  lightbox,
  popover,
  draftPlace,
  threadPlace,
  tool,
  overlays,
  areaMode,
  canDrawArea,
  imageDraft,
  setTool,
  toggleOverlay,
  commentOnSelection,
  pickImage,
  pen,
} = annotations
// Hidden comments (the review pill's eye) stay hidden on every drop until the eye shows them again.
const commentsShown = useCommentsShown()
overlays.pins = commentsShown.value
watch(
  () => overlays.pins,
  (pins) => (commentsShown.value = pins),
)
/** Whether the drop shows in the frame, where the toolbar's tools work: not an editor, a folder, a site, a board, a link, a video. */
const framed = computed(
  () =>
    !editing.value &&
    !["folder", "site", "board", "link"].includes(drop.value.kind) &&
    !video.value &&
    !(drop.value.kind === "file" && !drop.value.html),
)
watch(framed, (value) => !value && (tool.value = "browse"))
/** Whether the page can show at a device's size (ViewerDevice): HTML docs and apps, not Markdown docs, images, or spreadsheets. */
const sizable = computed(() => framed.value && ["html", "app"].includes(drop.value.kind))
/** Whether the viewer stops above the review dock: boards, apps and files have controls along their bottom edge. A
 * video clears the dock inside its own stage, so the stage's color runs under the dock. A site runs under the dock like
 * an HTML doc, and its setup page keeps its own trailing room (ViewerSite). */
const dockClearance = computed(
  () =>
    !editing.value && !trashed.value && !video.value && ["board", "app", "file", "folder"].includes(drop.value.kind),
)
function closeLightbox() {
  lightbox.value = null
  popover.value = null
}
const popoverRef = useTemplateRef<{ fail: (reason?: string, text?: string) => Promise<void> }>("popoverRef")
const shareOpen = ref(false)
watch(shareOpen, (open) => {
  if (!open) return
  detailsPop.value = null
  if (commentsOpen.value) closeComments()
})

// Someone reading a doc's link (not a pinned or older version) moves to each new version as it's published, unless
// they're commenting, selecting, or sharing. Editors are left out: the live editor tells them itself (useLiveEditor).
useLatestVersion(drop, {
  enabled: () => publicView && !route.query.v && !older.value && !trashed.value && !editing.value,
  busy: () => Boolean(commentsOpen.value || selection.value || lightbox.value || shareOpen.value),
})

// Who else has the drop open, and their cursors on this version or app page (usePresence). The others load comments
// the moment someone writes one, rather than on their next look.
const presence = usePresence(drop, {
  at: () => (drop.value.kind === "site" ? null : `v${drop.value.version}${isApp.value ? app.page.value : ""}`),
  enabled: () => !visitor.value && !trashed.value,
})
state.onWrote(() => presence.commented())
watch(presence.commentsChange, (change, before) => {
  if (change === before) return
  void state.comments.refresh()
  void siteReview?.refresh()
})

function startEdit() {
  if (lightbox.value) return
  closeComments()
  popover.value = null
  closeChanges()
  detailsPop.value = null
  void live.open()
}
// Both pages key this viewer by the drop's id and version, so another version (a teammate's "Open", the sidebar, an app
// republished in place) mounts a new one; the old one leaves its draft's room as it unmounts (useLiveEditor).
onMounted(() => {
  if (route.query.edit === "1" && drop.value.canEdit) startEdit()
})

const pageComments = computed(() =>
  isApp.value
    ? comments.value.filter(
        (comment) => comment.page === page.value || (!comment.page && page.value === pages.value[0]),
      )
    : comments.value,
)

// Open comments carry over from earlier versions (server/utils/comments.ts). One is outdated when this version no
// longer has what it pointed at: the frame couldn't find its text or element (it says which), or the drop is an image,
// where every version is a new picture.
// TODO(apps): apps replace their files in place, so their comments all count as this version's and never go
// outdated. That needs app versions kept (see publishApp in server/utils/drops.ts).
const replaced = (comment: DropComment) => drop.value.kind === "image" && comment.version < drop.value.version
// A resolved comment leaves the page and stays in the panel's Resolved list; it shows again while its thread is open.
const onPage = (comment: DropComment) =>
  !comment.resolved || (popover.value?.type === "thread" && popover.value.id === comment.id)
// Comments on the whole page have nothing in it to pin to; they live in the panel.
const pinned = computed(() =>
  pageComments.value.filter((comment) => onPage(comment) && !replaced(comment) && comment.kind !== "page"),
)

// Whether the Comments list was open when a new comment started: it comes back once that comment is sent or dropped.
let listBefore = false
function startComment() {
  listBefore = commentsOpen.value
  showComments()
}
watch(popover, (value, before) => {
  // A thread floats beside its pin or over its card in the margin, so the list comes back after it only if it was open
  // before.
  if (!before && (value?.type === "new" || value?.type === "thread")) startComment()
  else if (value) showComments()
  // Writing a comment or opening one brings hidden comments back.
  if (value) overlays.pins = true
})
watch(areaMode, (active) => active && showComments())
watch(
  () => siteRef.value?.pending,
  (pending) => pending && startComment(),
)
// On wide screens a new comment on a selection, an element, or an area is written in a card floating over the page,
// where its card lands once sent: in the margin beside a doc's text (the frame keeps that place, draft-place), else
// under what it points at. Page-wide comments, threads, sites, and the lightbox's keep the dock.
// The Pin style (useCommentStyle) on a Markdown doc's text: a pin in the gutter, and beside it, at any width, a small
// composer for a new comment or the thread of the pin clicked. Selected text gets the selection bar either way, so the
// reader picks Comment or Suggest before writing.
const commentStyle = useCommentStyle()
const commentStyles: { value: CommentStyle; label: string }[] = [
  { value: "card", label: "Cards beside the text" },
  { value: "pin", label: "Pins beside the text" },
]
const pinStyle = computed(() => commentStyle.value === "pin" && drop.value.kind === "markdown")
const pinOpen = computed(() => commentsOpen.value && !editing.value && !trashed.value && !lightbox.value)
const pinDraft = computed(
  () => pinStyle.value && pinOpen.value && popover.value?.type === "new" && popover.value.pending.kind === "text",
)
/**
 * Where the open thread is written in, so a reply never sends the reader to the dock: over its card in the margin
 * (`rail`), else beside its pin, as the frame reports it while the page scrolls. The lightbox's pins aren't in the frame,
 * so a thread opened there sits beside the pin that was clicked. A thread opened from the list waits for its place.
 */
// A thread that opened in the dock, because its place came too late or never, stays there until it closes: moving it
// later would mount a new reply box and drop what the reader typed.
const dockedThread = ref<string | null>(null)
const threadSpot = computed(() => {
  const open = popover.value
  if (open?.type !== "thread" || editing.value || trashed.value) return undefined
  if (lightbox.value)
    return open.x || open.y
      ? { rail: false, rect: { left: open.x - 12, top: open.y - 12, right: open.x + 12, bottom: open.y + 12 } }
      : undefined
  if (dockedThread.value === open.id) return undefined
  return commentsOpen.value && threadPlace.value?.id === open.id ? threadPlace.value : undefined
})
const pinThread = computed(() => Boolean(threadSpot.value))
// Escape in the compact composer drops the draft, words and pictures.
function dropPinDraft() {
  reviewDraft.body.value = ""
  reviewDraft.images.clear()
  popover.value = null
}
const PIN_BUBBLE_WIDTH = 300
const THREAD_WIDTH = 340
const pinRef = useTemplateRef<HTMLElement>("pinRef")
const { height: bubbleHeight } = useElementSize(pinRef, undefined, { box: "border-box" })
// Right of the pin, level with it; past the page's right edge, under it instead, else above it. The bubble grows from
// the pin. A thread on a card in the margin covers the card, its right edge on the card's, and grows from the card's
// top. Wherever it goes, it stays inside the window, over the pin or its area if nothing else fits, so the reply box
// can always be reached.
const pinBubbleStyle = computed(() => {
  const spot = pinDraft.value ? undefined : threadSpot.value
  const rect = pinDraft.value ? draftPlace.value?.rect : spot?.rect
  if (!rect) return undefined
  // Until it's measured, the bubble counts as tall as it may grow (max-h-[min(28rem,60dvh)]).
  const height = bubbleHeight.value || Math.min(448, windowHeight.value * 0.6)
  const inWindow = (top: number) => Math.max(56, Math.min(top, windowHeight.value - 12 - height))
  if (spot?.rail) {
    const width = Math.min(Math.max(THREAD_WIDTH, rect.right - rect.left), windowWidth.value - 24)
    const left = Math.max(12, Math.min(rect.right - width, windowWidth.value - 12 - width))
    return { width: `${width}px`, left: `${left}px`, top: `${inWindow(rect.top)}px`, transformOrigin: "100% 0" }
  }
  const width = Math.min(pinDraft.value ? PIN_BUBBLE_WIDTH : THREAD_WIDTH, windowWidth.value - 24)
  let left = rect.right + 8
  let top = inWindow(rect.top)
  let origin = "0 14px"
  if (left + width > windowWidth.value - 12) {
    left = Math.max(12, windowWidth.value - 12 - width)
    const below = rect.bottom + 8
    const above = rect.top - 8 - height
    top = below + height <= windowHeight.value - 12 ? below : above >= 56 ? above : inWindow(below)
    origin = top === below ? `${rect.left + 14 - left}px -8px` : `${rect.left + 14 - left}px ${height + 8}px`
  }
  return { width: `${width}px`, left: `${left}px`, top: `${top}px`, transformOrigin: origin }
})
const pinShown = computed(() => Boolean((pinDraft.value && draftPlace.value?.pin) || pinThread.value))

const floating = computed(
  () =>
    pinDraft.value ||
    pinThread.value ||
    (wide.value &&
      commentsOpen.value &&
      !editing.value &&
      !trashed.value &&
      !lightbox.value &&
      !siteRef.value?.pending &&
      popover.value?.type === "new"),
)
// A selection's card waits for its place, which the frame reports once the margin has made room for it.
const floatShown = computed(
  () =>
    !pinStyle.value &&
    !pinThread.value &&
    floating.value &&
    (popover.value?.type !== "new" || popover.value.pending.kind !== "text" || !!draftPlace.value),
)
// The floating card is one small surface, the line and its send button (ViewerPinComposer); a suggestion keeps the full
// composer for the words that replace the quote.
const compactFloat = computed(() => popover.value?.type === "new" && popover.value.pending.suggestion === undefined)
const FLOAT_WIDTH = 288
const floatStyle = computed(() => {
  const place = draftPlace.value
  const width = place?.rail ? place.rect.right - place.rect.left : FLOAT_WIDTH
  const left = place ? place.rect.left : (popover.value?.x ?? 0)
  const top = place ? (place.rail ? place.rect.top : place.rect.bottom + 8) : (popover.value?.y ?? 0) + 8
  return {
    width: `${width}px`,
    left: `${Math.min(Math.max(8, left), windowWidth.value - width - 8)}px`,
    top: `${Math.min(Math.max(56, top), windowHeight.value - 160)}px`,
  }
})
const floatRef = useTemplateRef<HTMLElement>("floatRef")
watch(floatShown, async (open) => {
  if (!open) return
  await nextTick()
  await whenHeld()
  if (floatShown.value) floatRef.value?.querySelector<HTMLElement>("[data-comment-editor] textarea")?.focus()
})
// A bubble that opens below the fold scrolls the page until it shows, above the dock; the frame then moves the pin
// and the bubble follows.
watch(
  () => pinShown.value && (pinDraft.value ? "new" : popover.value?.type === "thread" ? popover.value.id : null),
  async (open) => {
    if (!open) return
    await nextTick()
    await whenHeld()
    const box = pinRef.value?.getBoundingClientRect()
    if (pinDraft.value) pinRef.value?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true })
    if (!box) return
    const over = box.bottom - (windowHeight.value - 88)
    if (over > 0) send({ type: "scroll-by", y: Math.min(over, Math.max(0, box.top - 64)) })
  },
)
watch(floating, (open, was) => {
  if (!open && was && commentsOpen.value && !popover.value && !listBefore) closeComments()
})
// The page loses its selection once the composer takes focus; it keeps the quote marked while the comment is written.
// A new selection while one is held (the Pin style's draft moving with the reader) holds the new one.
watch(
  () => (popover.value?.type === "new" && popover.value.pending.kind === "text" ? popover.value.pending : null),
  (pending, before) => (pending || before) && send({ type: pending ? "hold-selection" : "clear-selection" }),
)
// Mark area turns on Comments mode where the page has it, so the reader drags on the page with nothing over it; the
// Comments panel would cover what they draw on. Elsewhere the open panel is what lets the page take the drag.
function toggleCommentArea() {
  if (!canMarkArea.value) return
  if (canUseCommentMode.value && !editing.value && !trashed.value) commentMode.value = true
  else showComments()
}
// A `?changes=` link opens with History over the diff, as if the version had been picked there.
if (route.query.changes && hasHistory.value) showDetails("history")

// A Markdown doc reads at the reader's width, the same in the editor. W steps through them.
const docWidth = useDocWidth()
const widths: { value: DocWidth; label: string }[] = [
  { value: "readable", label: "Readable" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Widest" },
]
const widens = computed(() => drop.value.kind === "markdown")
function nextWidth() {
  const at = widths.findIndex((item) => item.value === docWidth.value)
  docWidth.value = widths[(at + 1) % widths.length]!.value
}

// An image in a folder moves along the folder's other images (useGallery).
const gallery = useGallery(drop, publicView)
const { items: galleryItems, at: galleryAt, prev: prevImage, next: nextImage } = gallery

const frame = useTemplateRef<HTMLIFrameElement>("frame")
const {
  srcdoc,
  contentOrigin,
  frameSrc,
  frameKey,
  frameScheme,
  ready,
  send,
  unplaced,
  openPath,
  variants,
  picker,
  whenHeld,
} = useViewerFrame({
  drop,
  frame,
  app,
  pinned,
  // The panel sits beside the frame, not over it: the doc has nothing to make room for.
  inset: ref(0),
  // The dock floats over a doc (see dockClearance), which would cover the bottom of a zoom the doc opens.
  bottom: computed(() => (hasComments.value && !trashed.value && !dockClearance.value ? 72 : 0)),
  width: docWidth,
  annotations,
  clickComments: commentMode,
  comments: computed(() => ({
    style: pinStyle.value ? "pin" : "card",
    me: me.value ? { name: me.value.name, image: me.value.image ?? null } : null,
  })),
  variantBar: true,
  arrow: (key) => galleryShown.value && gallery.step(key === "ArrowLeft" ? -1 : 1),
  presence,
})

const outdated = computed(
  () =>
    new Set(
      comments.value
        .filter(
          (comment) => comment.version < drop.value.version && (replaced(comment) || unplaced.value.has(comment.id)),
        )
        .map((comment) => comment.id),
    ),
)
/**
 * The version whose changes show in place of the document (ViewerDiff), and the one before it. It lives in the address
 * (`?changes=<n>`), so the link opens the same diff and the browser's Back returns to the document.
 */
const router = useRouter()
const setQuery = useSetQuery()
const shownVersion = computed(() => {
  const n = Number(route.query.changes)
  return (n && drop.value.versions.find((item) => item.version === n)) || null
})
const previousVersion = computed(() =>
  shownVersion.value
    ? (drop.value.versions[drop.value.versions.findIndex((item) => item.version === shownVersion.value!.version) + 1] ??
      null)
    : null,
)
// The folder's images show over the image, not over its lightbox or a version's changes.
const galleryShown = computed(() => galleryItems.value.length > 0 && !lightbox.value && !shownVersion.value)
// Opening a diff from the document adds a history entry; moving between versions replaces it, so one Back always
// lands on the document. Closing steps back over that entry rather than adding another one.
let pushedChanges = false
watch(shownVersion, (value) => !value && (pushedChanges = false))
/** Picking the open version again goes back to the document. On a phone History steps aside for the diff. */
function showVersion(version: DropVersion) {
  if (editing.value) return
  if (shownVersion.value?.version === version.version) return closeChanges()
  const opening = !shownVersion.value
  void setQuery({ changes: version.version }, { push: opening })
  if (opening) pushedChanges = true
  if (phone.value) detailsPop.value = null
}
function closeChanges() {
  if (!shownVersion.value) return
  if (pushedChanges) return router.back()
  void setQuery({ changes: undefined })
}

// Apps and HTML pages open alone in another window (ViewerPresent): a deck for the projector, which Slidev's presenter
// view in this frame then drives.
const presents = computed(() => isApp.value || drop.value.kind === "html")
function openWindow() {
  const query = new URLSearchParams({ present: "" })
  if (older.value) query.set("v", String(drop.value.version))
  if (isApp.value && appAt.value !== "/") query.set("path", appAt.value)
  window.open(`${dropPath(drop.value)}?${query}`, "_blank", "popup")
}
// A Slidev build (its runtime under assets/slidev/) presents in one step: the deck alone in a new window for the
// projector, and Slidev's own presenter view (notes, next slide, timer) in this frame, which drives that window.
const slidev = computed(
  () => isApp.value && Boolean(drop.value.paths?.some((path) => path.startsWith("assets/slidev/"))),
)
function present() {
  openWindow()
  openPath("/presenter/1")
}

defineShortcuts({
  // With text selected in the page, C and E work on it, as the bar over it says.
  c: () => (selection.value ? commentOnSelection() : toggleCommentMode()),
  e: () => {
    if (selection.value) return commentOnSelection(true)
    if (editing.value || !showEditTool.value) return
    if (drop.value.canEdit) startEdit()
    else editNoteOpen.value = true
  },
  h: () => hasHistory.value && showDetails("history"),
  i: () => (detailsOpen.value ? (detailsOpen.value = false) : showDetails()),
  r: toggleCommentArea,
  v: () => (tool.value = "browse"),
  s: () => framed.value && setTool("measure"),
  b: () => canMark.value && annotations.mark("marker"),
  p: () => canMark.value && annotations.mark("pen"),
  a: () => canMark.value && annotations.mark("arrow"),
  meta_z: () => undoMark(),
  u: () => framed.value && toggleOverlay("rulers"),
  x: () => framed.value && toggleOverlay("xray"),
  l: () => !editing.value && copyLink("Link copied"),
  d: () => !editing.value && download(),
  m: () => !editing.value && copiesMarkdown.value && void copyMarkdown("Markdown copied"),
  w: () => widens.value && nextWidth(),
  meta_s: { usingInput: true, handler: () => editing.value && void live.publish() },
})
// The Marker's size and Done, while it's on and nothing is being typed.
const typing = (event: KeyboardEvent) =>
  event.target instanceof HTMLElement &&
  (event.target.isContentEditable || /^(input|textarea|select)$/i.test(event.target.tagName))
onKeyStroke(["[", "]", "Enter"], (event) => {
  if (!marking.value || event.defaultPrevented || typing(event) || event.metaKey || event.ctrlKey || event.altKey)
    return
  if (event.key === "Enter") {
    if (event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    return finishMark()
  }
  annotations.resize(event.key === "[" ? -1 : 1)
})
// Dialogs and menus consume Escape first. Only handle it here when it reaches the document unhandled.
onKeyStroke("Escape", (event) => {
  if (event.defaultPrevented || shareOpen.value || lightbox.value || editing.value) return
  // The segment's popover closes itself first (Escape stops there); the next Escape folds the segment.
  if (detailsPop.value) {
    detailsPop.value = null
    return
  }
  if (detailsOpen.value && !popover.value && !commentsOpen.value) {
    if (performance.now() - detailsPopClosedAt > 100) detailsOpen.value = false
    return
  }
  closeChanges()
  if (popover.value) popover.value = null
  else if (commentsOpen.value) closeComments()
  else if (commentMode.value) commentMode.value = false
  annotations.dismiss()
})

/** Saves the stored file under its uploaded name; the raw URL is same-origin, so `download` names it. */
function download() {
  if (!drop.value.url) return
  const anchor = document.createElement("a")
  anchor.href = drop.value.url
  anchor.download = drop.value.filename
  anchor.click()
}

// Export as PDF: the frame prints itself (plan-runtime.ts), so the PDF holds the whole doc as rendered, not the
// slice of it the viewer shows. Only Markdown docs: their frame alone may open the print dialog (previewSandbox).
const printsPdf = computed(() => drop.value.kind === "markdown" && !editing.value && ready.value)
const exportPdf = () => send({ type: "print", title: drop.value.title })

// The version on screen, as the server converts it (server/middleware/0.09.drop-markdown.ts): the same text agents get.
const copiesMarkdown = computed(() => drop.value.kind === "markdown" || drop.value.kind === "html")

// The header's links: a Markdown doc's preview deploys, which are for opening; its other links read with its front
// matter at the top of the doc (server/utils/markdown-document.ts withDocProperties). Every other drop shows them all.
const headerLinks = computed(() => {
  const links = drop.value.resources ?? []
  return drop.value.kind === "markdown" ? links.filter(isPreviewLink) : links
})

// Drops are related through the pages they link to, so only a drop with links, or a site, can have related drops.
const relatesTo = computed(() =>
  drop.value.kind === "site" || drop.value.resources?.length ? drop.value.id : undefined,
)

// The segment's chip: the size (a folder's item count) and, for its owner, the views.
const detailsMeta = computed(() => {
  const d = drop.value
  const size =
    d.kind === "folder"
      ? itemCount(d.items ?? 0)
      : d.kind === "site" || d.kind === "link"
        ? KIND_LABELS[d.kind]
        : formatBytes(d.size)
  const views = d.views ? d.views.person + d.views.anonymous + d.views.agent : null
  return views === null ? size : `${size} · ${views} ${views === 1 ? "view" : "views"}`
})
// What the details panel listed as rows, as the segment's icons: the same rows for the same people.
const detailsActions = computed<DetailsAction[]>(() => [
  ...(drop.value.url
    ? [{ id: "download", label: "Download original", icon: "i-mingcute-download-2-line", kbd: "D", press: download }]
    : []),
  ...(copiesMarkdown.value
    ? [
        {
          id: "markdown",
          label: copied("markdown") ? "Copied" : "Copy as Markdown",
          icon: copied("markdown") ? "i-mingcute-check-line" : "i-mingcute-markdown-line",
          kbd: "M",
          press: () => void copyMarkdown(),
        },
      ]
    : []),
  ...(printsPdf.value ? [{ id: "pdf", label: "Export as PDF", icon: "i-mingcute-pdf-line", press: exportPdf }] : []),
  ...(presents.value && !slidev.value
    ? [{ id: "window", label: "Open in new window", icon: "i-mingcute-external-link-line", press: openWindow }]
    : []),
  ...(owner.value && !trashed.value
    ? [
        {
          id: "move",
          label: "Move to folder",
          icon: "i-mingcute-new-folder-line",
          press: () => moveTo({ drop: drop.value }),
        },
      ]
    : []),
  ...(visitor.value
    ? [
        {
          id: "report",
          label: "Report",
          icon: "i-mingcute-flag-1-line",
          to: { path: "/report", query: { target: `/d/${drop.value.link}` } },
        },
      ]
    : []),
  ...(drop.value.canTrash && !trashed.value
    ? [{ id: "trash", label: "Move to Trash", icon: "i-mingcute-delete-2-line", destructive: true, press: deleteDrop }]
    : []),
])
const copyMarkdown = (announce?: string) =>
  copyLoading(
    $fetch<string>(`${dropPath(drop.value)}.md`, { query: { v: drop.value.version }, responseType: "text" }),
    { key: "markdown", announce },
  )
const copyFeedback = () =>
  copy(feedbackMarkdown(drop.value.title, link.value, comments.value, drop.value.version), { key: "feedback" })
// A private drop has no working link yet, so its owner gets Share instead; a teammate's still copies. An app's link
// opens the page showing (`?path=`).
function copyLink(announce?: string) {
  if (owner.value && drop.value.share === "private") return void (shareOpen.value = true)
  const url = new URL(link.value)
  if (isApp.value && appAt.value !== "/") url.searchParams.set("path", appAt.value)
  void copy(url.href, { key: "link", announce })
}
const canMarkArea = computed(
  () =>
    annotationsEnabled.value &&
    !lightbox.value &&
    (canDrawArea.value || (drop.value.canComment && siteRef.value?.canDraw && !siteRef.value.pending)),
)
// The primary Comments action opens the list wherever the frame cannot take clicks for a sendable area comment.
const canUseCommentMode = computed(() => framed.value && canDrawArea.value && !shownVersion.value)
const canCommentOnPage = computed(
  () => drop.value.canComment && annotationsEnabled.value && !editing.value && !lightbox.value,
)
watch(canUseCommentMode, (available) => !available && (commentMode.value = false))
const inspectable = computed(
  () => framed.value && annotationsEnabled.value && !lightbox.value && ["html", "app"].includes(drop.value.kind),
)
/** Whether the Marker can draw on a snapshot of the page: docs, images, HTML, and apps in the frame. */
const canMark = computed(() => framed.value && canDrawArea.value && !shownVersion.value)
const marking = computed(() => tool.value === "mark")
const markTools = computed(() => [
  ...(inspectable.value ? (["browse", "measure"] as const) : []),
  ...(canMark.value ? (["mark"] as const) : []),
])
function finishMark() {
  if (!marking.value || !annotations.marks.value || annotations.finishing.value) return
  annotations.finishing.value = true
  send({ type: "mark", do: "done" })
}
const undoMark = () => marking.value && send({ type: "mark", do: "undo" })
// Open when someone reaches for Edit on a doc the editor can't take: the popover says why.
const editNoteOpen = ref(false)
const showEditTool = computed(
  () =>
    !lightbox.value &&
    !shownVersion.value &&
    (drop.value.canEdit || (drop.value.kind === "markdown" && drop.value.editNote)),
)
watch(shownVersion, (version) => {
  if (version) {
    tool.value = "browse"
    annotations.dismiss()
    commentsOpen.value = false
  }
})

// Keep drafts and image picks until the server accepts them, including after a retry.
async function submit(body: string, files: File[] = [], mentions: string[] = []) {
  const open = popover.value
  if (open?.type !== "new") return
  // A comment sent the moment its area is drawn still takes the picture the frame is taking of it.
  const before = reviewDraft.images.picks.value.length
  reviewDraft.waiting.value = true
  try {
    await annotations.waitForShot()
  } finally {
    reviewDraft.waiting.value = false
  }
  if (popover.value !== open) return
  const attached = reviewDraft.images.picks.value.length === before ? files : reviewDraft.images.files.value
  const finish = reviewDraft.beginSend()
  if (!finish) return
  const composer = popoverRef.value
  try {
    const sent = await state.addComment(
      { ...open.pending, ...(isApp.value ? { page: page.value } : {}) },
      body,
      attached,
      mentions,
    )
    if (!("value" in sent)) {
      if (popoverRef.value === composer) composer?.fail(sent.error)
      return
    }
    const cleared = finish(true)
    if (popover.value !== open || popoverRef.value !== composer) return
    if (!cleared) return composer?.fail()
    popover.value = null
    send({ type: "clear-selection" })
  } finally {
    finish(false)
  }
}

/**
 * A thread or row that goes away with its comment (resolved, accepted, deleted) drops the focus it held. Hand it to the
 * comments' composer when they're open, else to the review button; focus the reader moved elsewhere stays put.
 */
async function keepFocus() {
  await nextTick()
  if (document.activeElement && document.activeElement !== document.body) return
  if (commentsOpen.value) commentsRef.value?.focusComposer()
  else reviewDock.value?.focusTrigger()
}

async function resolve(id: string, resolved: boolean) {
  popover.value = null
  await state.resolveComment(id, resolved)
  await keepFocus()
}

// A suggestion goes into the doc from its latest version, by someone who could edit it by hand.
const canAccept = computed(() => drop.value.kind === "markdown" && drop.value.canEdit && !shownVersion.value)
const accepting = ref<string | null>(null)
async function accept(id: string) {
  if (accepting.value) return
  accepting.value = id
  try {
    if (await state.acceptSuggestion(id)) popover.value = null
  } finally {
    accepting.value = null
  }
  await keepFocus()
}

async function removeComment(id: string) {
  popover.value = null
  await state.removeComment(id)
  await keepFocus()
}

// A comment's link opens the drop with its thread showing (?comment=<n>, read below). It's the drop's own link, so
// it works for whoever can open the drop. The menu that copied it closes, so StatusNote says it was copied.
function copyCommentLink(comment: DropComment) {
  const url = new URL(link.value)
  url.searchParams.set("comment", String(comment.n))
  void copy(url.href, { announce: "Link to the comment copied" })
}
/** The drop's link with the diff showing: it opens the same changes, History beside them. */
function copyChangesLink(version: DropVersion) {
  const url = new URL(link.value)
  url.searchParams.set("changes", String(version.version))
  void copy(url.href, { key: "changes", announce: "Link to the changes copied" })
}

/** Select the thread immediately; the frame only scrolls to its anchor. */
async function focusComment(comment: DropComment) {
  popover.value = { type: "thread", id: comment.id, x: 0, y: 0 }
  showComments()
  if (isApp.value && comment.page && comment.page !== page.value) {
    page.value = comment.page
    await nextTick()
    await until(ready)
      .toBe(true, { timeout: 5000 })
      .catch(() => {})
  }
  if (comment.kind === "page") return
  // A resolved comment joins the pins once its thread opens: the frame takes the new pins first.
  await nextTick()
  send({ type: "focus", id: comment.id, open: false })
}

// `?comment=<n>` from a copied link: once the frame has placed the pins, open that thread with the comments showing.
onMounted(async () => {
  const n = Number(route.query.comment)
  if (!n || !hasComments.value) return
  if (["markdown", "image", "html", "app"].includes(drop.value.kind))
    await until(ready)
      .toBe(true, { timeout: 10000 })
      .catch(() => {})
  const comment = comments.value.find((item) => item.n === n)
  if (!comment) return notify.say(`Comment #${n} isn't on this version`, { icon: "i-mingcute-chat-1-line" })
  void focusComment(comment)
})

async function deleteDrop() {
  if (await remove(drop.value)) await navigateTo("/drops")
}

// The folders above, as breadcrumbs: in the app for people signed in, at their share links on a public page.
const moveTo = useMoveDialog()
const crumbTo = (crumb: { id: string; link: string; slug: string }) =>
  publicView ? dropPath(crumb) : `/drops/${crumb.id}`

// ⌘K offers the same actions as the header, review dock, and Details.
usePaletteOffer("drop", () => {
  if (visitor.value) return null
  if (editing.value)
    return {
      title: drop.value.title,
      items: [
        {
          label: "Publish the draft",
          icon: "i-mingcute-upload-line",
          kbds: ["meta", "s"],
          onSelect: () => void live.publish(),
        },
      ],
    }
  if (trashed.value)
    return {
      title: drop.value.title,
      items: owner.value
        ? [{ label: "Restore", icon: "i-mingcute-back-2-line", onSelect: () => void restoreDrop() }]
        : [],
    }
  const items: CommandPaletteItem[] = [
    ...(drop.value.canEdit && !lightbox.value && !shownVersion.value
      ? [{ label: "Edit together", icon: "i-mingcute-edit-2-line", kbds: ["e"], onSelect: startEdit }]
      : []),
    ...(hasComments.value
      ? [{ label: "Comments", icon: "i-mingcute-chat-1-line", kbds: ["c"], onSelect: showComments }]
      : []),
    ...(canMarkArea.value
      ? [
          {
            label: "Comment on an area",
            icon: "i-mingcute-message-1-line",
            kbds: ["r"],
            onSelect: toggleCommentArea,
          },
        ]
      : []),
    ...(hasHistory.value
      ? [{ label: "History", icon: "i-mingcute-history-line", kbds: ["h"], onSelect: () => showDetails("history") }]
      : []),
    { label: "Details", icon: "i-mingcute-information-line", kbds: ["i"], onSelect: () => showDetails("meta") },
    { label: "Copy link", icon: "i-mingcute-link-line", kbds: ["l"], onSelect: () => copyLink("Link copied") },
    ...(drop.value.url
      ? [{ label: "Download", icon: "i-mingcute-download-2-line", kbds: ["d"], onSelect: download }]
      : []),
    ...(printsPdf.value ? [{ label: "Export as PDF", icon: "i-mingcute-pdf-line", onSelect: exportPdf }] : []),
    ...(slidev.value && contentOrigin.value
      ? [{ label: "Present", icon: "i-mingcute-presentation-2-line", onSelect: present }]
      : []),
    ...(presents.value && !slidev.value
      ? [{ label: "Open in new window", icon: "i-mingcute-presentation-2-line", onSelect: openWindow }]
      : []),
    ...(drop.value.resources ?? []).map((resource) => ({
      label: `Open ${resourceLabel(resource)}`,
      icon: "i-mingcute-external-link-line",
      to: resource.url,
      target: "_blank",
    })),
    ...(copiesMarkdown.value
      ? [
          {
            label: "Copy as Markdown",
            icon: "i-mingcute-markdown-line",
            kbds: ["m"],
            onSelect: () => void copyMarkdown("Markdown copied"),
          },
        ]
      : []),
    ...(owner.value
      ? [{ label: "Share…", icon: SHARE_ICONS[drop.value.share], onSelect: () => (shareOpen.value = true) }]
      : []),
    ...(owner.value
      ? [
          {
            label: "Move to folder",
            icon: "i-mingcute-new-folder-line",
            onSelect: () => void moveTo({ drop: drop.value }),
          },
        ]
      : []),
    ...(drop.value.canTrash
      ? [{ label: "Move to Trash", icon: "i-mingcute-delete-2-line", onSelect: () => void deleteDrop() }]
      : []),
  ]
  return { title: drop.value.title, items }
})

// Areas drawn over an image in the page anchor to that image, so the lightbox shows them too.
const imageComments = computed(() =>
  lightbox.value
    ? pageComments.value.filter(
        (comment) =>
          comment.kind !== "text" && comment.selector === lightbox.value!.selector && !outdated.value.has(comment.id),
      )
    : [],
)
// The dock's list, the open thread, and the composer share one ViteHub comments state over the drop's comments.
provideDropComments({
  source: () => (lightbox.value ? imageComments.value : comments.value),
  page: () => (isApp.value ? page.value : undefined),
})
const threadComment = computed(() => {
  const open = popover.value
  return open?.type === "thread" ? comments.value.find((comment) => comment.id === open.id) : undefined
})
// A thread opened on the page waits a moment for the frame to say where its pin or card is, so the dock doesn't flash
// open under it. A comment on the whole page, or one the frame can't place, then opens in the dock.
const awaitingSpot = ref(false)
const spotWait = useTimeoutFn(
  () => {
    awaitingSpot.value = false
    if (!pinThread.value && popover.value?.type === "thread") dockedThread.value = popover.value.id
  },
  300,
  { immediate: false },
)
watch(
  () => (popover.value?.type === "thread" ? popover.value.id : null),
  (id) => {
    spotWait.stop()
    dockedThread.value = null
    awaitingSpot.value = Boolean(id && !lightbox.value && !siteRef.value && threadComment.value?.kind !== "page")
    if (awaitingSpot.value) spotWait.start()
  },
)
watch(pinThread, (shown) => shown && (awaitingSpot.value = false))
// The open thread stays in the address (`?comment=<n>`, read above), so it can be shared from the address bar too.
watch(
  () => (commentsOpen.value ? threadComment.value?.n : undefined),
  (n) => textValue(route.query.comment) !== (n ? String(n) : undefined) && void setQuery({ comment: n }),
)
</script>

<template>
  <DefineDetails>
    <ViewerOverview :drop="drop" :show-description="owner || (Boolean(me) && !publicView)" />
    <div v-if="widens" class="space-y-2 border-t border-default p-4">
      <label for="drop-comment-style" class="text-xs font-medium text-muted">Comments</label>
      <USelect id="drop-comment-style" v-model="commentStyle" class="w-full" :items="commentStyles" />
    </div>
  </DefineDetails>
  <DefineHistory>
    <LazyViewerHistory :comments="comments" :drop="drop" :selected="shownVersion?.version" @open="showVersion" />
  </DefineHistory>
  <!-- A new comment's composer, or the open thread: in the dock, or beside the page for a new comment on what's selected
       (floating). -->
  <DefineComposer>
    <div id="drop-site-composer" v-show="siteRef?.pending" class="flex min-h-0 flex-1 flex-col" />
    <ViewerCommentThread
      v-if="popover && !siteRef?.pending"
      :key="popover.type === 'thread' ? popover.id : 'new'"
      ref="popoverRef"
      :comment="threadComment"
      :screenshot="threadComment ? screenshots.get(threadComment.id) : undefined"
      :pending="popover.type === 'new' ? popover.pending : undefined"
      :draft="popover.type === 'new' ? popover.body : undefined"
      :draft-error="popover.type === 'new' ? popover.error : undefined"
      :floating="pinThread"
      :can-accept="canAccept"
      :accepting="Boolean(accepting) && accepting === threadComment?.id"
      :version="drop.version"
      @accept="accept"
      @cancel="backToComments"
      @copy-link="copyCommentLink"
      @delete="removeComment"
      @delete-reply="(id, replyId) => state.removeReply(id, replyId)"
      @resolve="resolve"
      @submit="submit"
      @suggest="(text) => popover?.type === 'new' && (popover.pending.suggestion = text)"
    />
  </DefineComposer>

  <UDashboardPanel id="drop-main" :ui="{ body: 'p-0 sm:p-0 gap-0 sm:gap-0 overflow-hidden' }">
    <template #header>
      <UDashboardNavbar :toggle="!visitor" :ui="{ root: 'h-12 gap-2 px-2 sm:px-3', left: 'min-w-0', title: 'min-w-0' }">
        <template #leading>
          <SidebarExpand v-if="!visitor" />
          <NuxtLink v-if="visitor" aria-label="Drop" class="grid size-8 place-items-center" to="/"
            ><DropMark class="h-4 w-6"
          /></NuxtLink>
          <UButton
            v-else-if="drop.ancestors.length"
            :aria-label="`Back to ${drop.ancestors.at(-1)!.title}`"
            color="neutral"
            icon="i-mingcute-arrow-left-line"
            size="sm"
            variant="ghost"
            :to="crumbTo(drop.ancestors.at(-1)!)"
          />
          <UButton
            v-else
            aria-label="Back to drops"
            color="neutral"
            icon="i-mingcute-arrow-left-line"
            size="sm"
            variant="ghost"
            to="/drops"
          />
        </template>
        <template #title>
          <ViewerLocation :drop="drop" :public-view="publicView" />
        </template>
        <template #trailing>
          <!-- A Markdown doc shows its other links in its properties, at the top of the doc. -->
          <ViewerResources :related-to="relatesTo" :resources="headerLinks" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="owner && trashed"
        :actions="[
          {
            label: 'Restore',
            color: 'error',
            variant: 'outline',
            size: 'sm',
            loading: restoring,
            onClick: restoreDrop,
          },
        ]"
        class="rounded-none border-0 border-b border-default"
        color="error"
        :description="
          drop.trashReason === 'expired'
            ? 'Nobody opened it for a while, so its link stopped working. Only you and admins can see it until you restore it.'
            : 'Its link stopped working. Only you and admins can see it until you restore it.'
        "
        icon="i-mingcute-delete-2-line"
        orientation="horizontal"
        :title="expiryLabel(drop, now)"
        variant="subtle"
      />
      <UAlert
        v-else-if="older"
        :actions="[
          { label: `Open v${latest.version}`, color: 'neutral', variant: 'outline', size: 'sm', to: latestTo },
        ]"
        class="rounded-none border-0 border-b border-default"
        color="neutral"
        :description="`v${latest.version} is the latest version.`"
        icon="i-mingcute-history-line"
        orientation="horizontal"
        :title="`You're reading v${drop.version}`"
        variant="subtle"
      />
      <UAlert
        v-else-if="sentVersion && sentNotice"
        :actions="[
          {
            label: `View v${sentVersion}`,
            color: 'neutral',
            variant: 'outline',
            size: 'sm',
            to: dropPath(drop, sentVersion),
          },
        ]"
        class="rounded-none border-0 border-b border-default"
        close
        color="neutral"
        :description="`The link you opened pointed at v${sentVersion}. This is v${drop.version}, the latest.`"
        icon="i-mingcute-arrow-right-up-line"
        orientation="horizontal"
        title="Updated since this link was shared"
        variant="subtle"
        @update:open="sentNotice = $event"
      />
      <div v-if="isApp" class="flex h-9 shrink-0 items-center gap-2 border-b border-default px-3">
        <span
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-elevated px-2.5 py-1 font-mono text-xs text-muted"
        >
          <UIcon :name="SHARE_ICONS[drop.share]" class="size-3 shrink-0" />
          <span class="truncate">{{ drop.slug || drop.link }}{{ appAt }}</span>
        </span>
        <USelect v-if="pages.length > 1" v-model="page" class="w-40 font-mono" :items="pages" size="xs" />
      </div>

      <!-- Documents, HTML docs and images run under the glass; Markdown and the live editor already have trailing room.
           Interactive viewers need clearance so their bottom controls stay clickable. -->
      <div class="relative flex min-h-0 flex-1 flex-col" :class="dockClearance ? 'pb-28 sm:pb-20' : ''">
        <div class="relative flex min-h-0 flex-1 flex-col">
          <!-- A draft the room turned away never syncs again, but its text stays readable. -->
          <LazyViewerEditor
            v-if="editing"
            :editor="live.editor.value"
            :synced="live.synced.value || live.refused.value !== undefined"
            :width="docWidth"
          />
          <LazyViewerFolder v-else-if="drop.kind === 'folder'" :drop="drop" :public-view="publicView" />
          <LazyViewerSite
            v-else-if="drop.kind === 'site'"
            ref="siteRef"
            :comments="comments"
            :dock-top="reviewDock?.top"
            :drop="drop"
            :reviewing="commentsOpen && drop.canComment && annotationsEnabled && !editing"
            :screenshots="screenshots"
            @focus="focusComment"
            @resolve="resolve"
          />
          <LazyViewerBoard v-else-if="drop.kind === 'board'" :key="drop.id" :drop="drop" />
          <LazyViewerLink v-else-if="drop.kind === 'link'" :drop="drop" />
          <LazyViewerVideo v-else-if="video && drop.url" :src="drop.url" :title="drop.title" :type="video" />
          <!-- A file with html is a spreadsheet the server rendered; it shows in the frame like a doc. -->
          <div v-else-if="drop.kind === 'file' && !drop.html" class="grid flex-1 place-items-center p-10 text-center">
            <div>
              <UIcon name="i-mingcute-file-line" class="size-8 text-dimmed" />
              <p class="mt-3 font-mono text-sm">{{ drop.filename }}</p>
              <p class="mt-1 text-sm text-muted">No preview for this file type.</p>
              <UButton
                v-if="drop.url"
                class="mt-4"
                color="neutral"
                icon="i-mingcute-download-2-line"
                label="Download"
                variant="outline"
                @click="download"
              />
            </div>
          </div>
          <ViewerDevice v-else-if="contentOrigin || srcdoc" :on="sizable" :bottom="dockClearance ? 16 : undefined">
            <iframe
              v-if="contentOrigin"
              :key="frameKey"
              ref="frame"
              class="block min-h-0 w-full flex-1 bg-default"
              :style="{ colorScheme: frameScheme }"
              :allow="frameAllow(drop.kind)"
              :sandbox="CONTENT_SANDBOX"
              :src="frameSrc"
              :title="drop.title"
            />
            <!-- Hydration mismatch reason: SSR/client bundlers format the srcdoc resolver differently. -->
            <iframe
              v-else
              ref="frame"
              class="block min-h-0 w-full flex-1 bg-default"
              :style="{ colorScheme: frameScheme }"
              data-allow-mismatch="attribute"
              :allow="frameAllow(drop.kind)"
              :sandbox="previewSandbox(drop.kind)"
              :srcdoc="srcdoc"
              :title="drop.title"
            />
          </ViewerDevice>

          <!-- The folder's images on either side, like a carousel's; the bar below has them too. -->
          <template v-if="galleryShown">
            <UTooltip v-if="prevImage" :kbds="['←']" :text="prevImage.title">
              <UButton
                aria-label="Previous image"
                data-gallery
                class="absolute top-1/2 left-3 z-10 -translate-y-1/2 rounded-full shadow-sm pointer-coarse:size-11 pointer-coarse:justify-center"
                color="neutral"
                icon="i-mingcute-left-line"
                variant="outline"
                @click="gallery.step(-1)"
              />
            </UTooltip>
            <UTooltip v-if="nextImage" :kbds="['→']" :text="nextImage.title">
              <UButton
                aria-label="Next image"
                data-gallery
                class="absolute top-1/2 right-3 z-10 -translate-y-1/2 rounded-full shadow-sm pointer-coarse:size-11 pointer-coarse:justify-center"
                color="neutral"
                icon="i-mingcute-right-line"
                variant="outline"
                @click="gallery.step(1)"
              />
            </UTooltip>
          </template>

          <LazyViewerDiff
            v-if="shownVersion && !editing"
            :key="shownVersion.version"
            :previous="previousVersion"
            :copied="copied('changes')"
            :version="shownVersion"
            @close="closeChanges"
            @copy-link="copyChangesLink(shownVersion)"
          />
        </div>
        <ViewerReviewDock
          ref="reviewDock"
          :class="{ invisible: siteRef?.capturing }"
          :open="commentsOpen && !editing && !trashed && !floating && !awaitingSpot"
          :overlay="Boolean(lightbox)"
          :settle="whenHeld"
          :heading="popover?.type === 'new' || siteRef?.pending ? 'row' : 'none'"
          title="New comment"
          @close="closeComments"
        >
          <template #panel>
            <ReuseComposer v-if="!floating" />
            <ViewerComments
              v-if="!popover && !siteRef?.pending"
              ref="commentsRef"
              :can-comment="canCommentOnPage"
              :comments="lightbox ? imageComments : comments"
              :outdated="outdated"
              @focus="focusComment"
            >
              <template #actions>
                <UTooltip v-if="comments.length && !popover" text="Copy feedback for your agent">
                  <UButton
                    aria-label="Copy feedback for your agent"
                    color="neutral"
                    :icon="copied('feedback') ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
                    :ui="{ leadingIcon: copied('feedback') ? 'animate-icon-in' : undefined }"
                    size="sm"
                    variant="ghost"
                    @click="copyFeedback"
                  />
                </UTooltip>
                <UButton
                  aria-label="Collapse comments"
                  color="neutral"
                  icon="i-mingcute-down-line"
                  size="sm"
                  variant="ghost"
                  @click="closeComments"
                />
              </template>
            </ViewerComments>
          </template>
          <template #toolbar>
            <template v-if="galleryShown">
              <LazyViewerGallery
                :at="galleryAt"
                :items="galleryItems"
                :to="gallery.to"
                @show="gallery.show"
                @step="gallery.step"
              />
              <span aria-hidden="true" class="w-1 shrink-0" />
            </template>
            <template v-if="variants && !editing && !lightbox && !shownVersion">
              <LazyViewerVariants :state="variants" @command="picker" />
              <span aria-hidden="true" class="w-1 shrink-0" />
            </template>
            <template v-if="editing">
              <!-- One presence ring instead of the outline's two: its inner ring is page-colored, not the glass behind it,
              and the pair reached past the pill's padding. -->
              <AvatarStack
                v-if="live.people.value.length"
                class="ml-1 [&_[data-slot=avatar-stack-item]]:shadow-[0_0_0_2px_var(--vh-avatar-color,var(--ui-border))]"
                :max="3"
                :people="live.people.value"
                :style="{ '--vh-avatar-size': '1.25rem' }"
                variant="outline"
              />
              <!-- A draft the room turned away has nothing to reconnect to (useLiveEditor). -->
              <span v-if="live.refused.value !== undefined" class="px-2 text-xs text-muted">{{
                live.refused.value ? "Out of date" : "Can't edit"
              }}</span>
              <ConnectionStatus
                v-else
                class="px-2 text-xs text-muted data-[status=reconnecting]:text-error"
                :status="live.status.value"
              >
                <ConnectionStatusLabel v-slot="{ state: connection }">{{
                  liveLabel(connection)
                }}</ConnectionStatusLabel>
              </ConnectionStatus>
              <UButton size="xs" color="neutral" label="Close" variant="ghost" @click="live.leave" />
              <UButton
                v-if="live.refused.value"
                size="xs"
                data-review-primary
                color="neutral"
                :label="`Open v${live.refused.value}`"
                @click="live.openRefused()"
              />
              <UButton
                v-else
                size="xs"
                data-review-primary
                color="neutral"
                :disabled="!live.synced.value"
                label="Publish"
                :loading="live.publishing.value"
                @click="live.publish()"
              />
            </template>
            <template v-else-if="hasComments && !trashed && marking">
              <LazyViewerMarkTools
                :finishing="annotations.finishing.value"
                :marks="annotations.marks.value"
                :pen="pen"
                @cancel="setTool('browse')"
                @color="pen.color = $event"
                @done="finishMark"
                @size="pen.sizes[pen.tip] = $event"
                @tip="annotations.mark($event)"
                @undo="undoMark"
              />
            </template>
            <template v-else-if="hasComments && !trashed">
              <ViewerToolbar
                v-if="
                  !lightbox &&
                  !shownVersion &&
                  (inspectable || canMark || sizable || (framed && pinned.length) || siteRef?.canDraw)
                "
                :tools="markTools"
                :views="inspectable ? ['rulers', 'xray', 'pins'] : pinned.length ? ['pins'] : []"
                :overlays="overlays"
                :sizable="sizable || Boolean(siteRef?.canDraw)"
                :tool="tool"
                @toggle="toggleOverlay"
                @tool="setTool"
              />
              <UButton
                size="xs"
                v-if="slidev && contentOrigin && !lightbox && !shownVersion"
                color="neutral"
                icon="i-mingcute-presentation-2-line"
                label="Present"
                variant="ghost"
                @click="present"
              />
              <UTooltip v-if="showEditTool && drop.canEdit" :kbds="['E']" text="Edit together">
                <UButton
                  size="xs"
                  color="neutral"
                  icon="i-mingcute-pencil-line"
                  label="Edit"
                  :loading="live.opening.value"
                  variant="ghost"
                  @click="startEdit"
                />
              </UTooltip>
              <LazyViewerEditNote
                v-else-if="showEditTool && drop.editNote"
                v-model:open="editNoteOpen"
                :can-comment="drop.canComment"
                :note="drop.editNote"
                @copy="copyMarkdown('Markdown copied')"
              />
              <ViewerCommentsSegment
                v-model:on="commentMode"
                :can-comment="canCommentOnPage"
                :can-use-mode="canUseCommentMode"
                :count="openCount"
                :list-open="commentsOpen && !popover"
                @toggle="toggleCommentMode"
                @list="toggleComments"
                @page="commentOnPage"
              />
            </template>
            <span v-if="editing || (hasComments && !trashed)" aria-hidden="true" class="w-1 shrink-0" />
            <template v-if="!editing">
              <ViewerDetailsSegment
                v-model:open="detailsOpen"
                v-model:pop="detailsPop"
                :actions="detailsActions"
                :meta="detailsMeta"
                :version="hasHistory ? `v${shownVersion?.version ?? drop.version}` : undefined"
                :width="widens ? widths.find((item) => item.value === docWidth)?.label : undefined"
                @width="nextWidth"
              >
                <template #details><ReuseDetails /></template>
                <template #history><ReuseHistory /></template>
              </ViewerDetailsSegment>
              <span aria-hidden="true" class="w-1 shrink-0" />
            </template>
            <template v-if="!editing && presence.people.value.length">
              <ViewerPresence
                v-model:show-cursors="presence.showCursors.value"
                :people="presence.people.value"
                :site="drop.kind === 'site'"
              />
              <span aria-hidden="true" class="w-1 shrink-0" />
            </template>
            <ViewerShare v-model:open="shareOpen" :drop="drop" />
          </template>
        </ViewerReviewDock>
      </div>
    </template>
  </UDashboardPanel>

  <!-- On <body>: as the dashboard's last child they'd put the panel's lg:not-last:border-e on it, and the doc would
       shift a pixel whenever text is selected. -->
  <Teleport to="body">
    <section
      v-if="floatShown"
      ref="floatRef"
      aria-label="New comment"
      class="fixed z-40 flex max-h-[min(24rem,60dvh)] origin-top-left flex-col overflow-y-auto overscroll-contain bg-default motion-safe:[animation:pop-in_150ms_var(--ease-out)]"
      :class="
        compactFloat
          ? 'rounded-[6px_18px_18px_18px] shadow-[0_0_0_1px_rgb(0_0_0/6%),0_2px_4px_rgb(0_0_0/6%),0_10px_24px_-6px_rgb(0_0_0/18%)] dark:shadow-[0_0_0_1px_rgb(255_255_255/10%)]'
          : 'rounded-lg border border-default shadow-lg'
      "
      :style="floatStyle"
    >
      <ViewerPinComposer v-if="compactFloat" ref="popoverRef" @cancel="dropPinDraft" @submit="submit" />
      <ReuseComposer v-else />
    </section>
    <Transition
      enter-active-class="motion-safe:transition-[opacity,scale] motion-safe:duration-180 motion-safe:ease-[cubic-bezier(.23,1,.32,1)]"
      enter-from-class="scale-96 opacity-0"
      leave-active-class="motion-safe:transition-[opacity,scale] motion-safe:duration-120 motion-safe:ease-out"
      leave-to-class="scale-98 opacity-0"
    >
      <section
        v-if="pinShown"
        ref="pinRef"
        :aria-label="pinDraft ? 'Comment on selected text' : 'Comment thread'"
        class="fixed z-40 flex max-h-[min(28rem,60dvh)] flex-col overflow-y-auto overscroll-contain border border-default bg-default shadow-lg"
        :class="
          pinDraft
            ? 'rounded-[6px_18px_18px_18px]'
            : threadSpot?.rail
              ? 'rounded-xl p-1.5'
              : 'rounded-[6px_16px_16px_16px] p-1.5'
        "
        role="dialog"
        :style="pinBubbleStyle"
        @keydown.esc="popover = null"
      >
        <ViewerPinComposer v-if="pinDraft && compactFloat" ref="popoverRef" @cancel="dropPinDraft" @submit="submit" />
        <ReuseComposer v-else />
      </section>
    </Transition>
    <div
      v-if="selection && (!commentsOpen || !popover)"
      class="fixed z-30 -translate-x-1/2 -translate-y-full"
      :style="{
        left: `${Math.min(Math.max(60, (selection.rect.left + selection.rect.right) / 2), windowWidth - 60)}px`,
        top: `${Math.max(56, selection.rect.top - 8)}px`,
      }"
    >
      <ViewerSelectionBar @comment="commentOnSelection()" @suggest="commentOnSelection(true)" />
    </div>
    <!-- Focus stays in the page while text is selected there, so a screen reader hears the keys instead of the bar. -->
    <p aria-live="polite" class="sr-only">
      {{ selection ? "Text selected. Press C to comment on it, or E to suggest new words." : "" }}
    </p>

    <LazyViewerLightbox
      v-if="lightbox"
      :alt="lightbox.alt"
      :can-comment="drop.canComment"
      :comments="imageComments.filter(onPage)"
      :draft="imageDraft"
      :from="lightbox.from"
      :src="lightbox.src"
      @close="closeLightbox"
      @pick="pickImage"
      @thread="(id, x, y) => (popover = { type: 'thread', id, x, y })"
    />
  </Teleport>
</template>
