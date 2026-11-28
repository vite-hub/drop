<script setup lang="ts">
import type { DocWidth } from "#shared/documents"
import type { DetailsAction } from "~/components/viewer/ViewerDetailsSegment.vue"
import type { PdfPage } from "~/components/viewer/ViewerPdf.vue"
import type { VideoFrame } from "~/components/viewer/ViewerVideo.vue"
import { breakpointsTailwind } from "@vueuse/core"
import type { CommentStyle } from "~/composables/usePreferences"
import type { ViewerVariants } from "~/composables/useViewerFrame"
import { expiryLabel } from "#shared/expiry"
import { dropPath } from "#shared/links"
import { isPdf, videoType } from "#shared/plans"
import { clock, startTime } from "#shared/video-time"
import type { DocHeader, DocHeaderFact, DocHeaderFolder, DocHeaderKindIcon, DocHeaderWho } from "#shared/doc-header"
import { knownAgent } from "#shared/agents"
import { feedbackMarkdown, feedbackPromptTarget, promptMarkdown, waitingForAnswer } from "#shared/feedback"
import { describeTime } from "comark-time"
import { resourceLabel } from "#shared/resources"
import { SHARE_ICONS } from "#shared/share"
import type { CommandPaletteItem } from "@nuxt/ui"
import type {
  DropComment,
  DropKind,
  DropRuntimeError,
  DropSummary,
  DropVersion,
  RelatedDrop,
  SiteReviewItem,
} from "#shared/types"
import {
  AvatarStack,
  CommentSelectionBar,
  ConnectionStatus,
  ConnectionStatusLabel,
  type ConnectionStatusState,
  createCommentVisibility,
} from "vite-hub/ui"
import "vite-hub/ui/styles.css"

const { publicView = false } = defineProps<{ publicView?: boolean }>()

const state = injectDrop()!
const drop = computed(() => state.drop.data.value!)
const publishedComments = computed(() => state.comments.data.value)
const comments = computed(() => state.list.value)

const siteReview =
  drop.value.kind === "site"
    ? useApi<SiteReviewItem[]>(() => `/api/drops/${drop.value.id}/review`, {
        key: () => keys.review(drop.value.id),
        default: () => [],
        onRequest: state.commentRead,
      })
    : undefined
const screenshots = computed(() => new Map((siteReview?.data.value ?? []).map((item) => [item.id, item.screenshot])))

const route = useRoute()
const notify = useNotify()
const { copy, copyLoading, copied } = useCopy()
const { remove, restore, setPinned } = useDropActions()
const [DefineDetails, ReuseDetails] = createReusableTemplate()
const [DefineHistory, ReuseHistory] = createReusableTemplate()
const [DefineComposer, ReuseComposer] = createReusableTemplate()
const { width: windowWidth, height: windowHeight } = useWindowSize()

const isApp = computed(() => drop.value.kind === "app")
const video = computed(() => (drop.value.kind === "file" ? videoType(drop.value.filename) : undefined))
const pdf = computed(() => drop.value.kind === "file" && isPdf(drop.value.filename))
const owner = computed(() => drop.value.isOwner)
const { data: me } = useMe()
const visitor = computed(() => publicView && !me.value)
const openCount = computed(() => comments.value.filter(needsLook).length)
const second = useNow({ scheduler: (update) => useIntervalFn(update, 1000) })
const outbox = useCommentsOutbox()
const deliveryCount = computed(() => waitingCount(comments.value, outbox.clock(second.value.getTime())))
const link = useShareUrl(drop)
const now = useRelativeNow()
const trashed = computed(() => drop.value.trashedAt !== null)
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

const breakpoints = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 })
const wide = breakpoints.greaterOrEqual("lg")
const phone = breakpoints.smaller("sm")
const detailsOpen = ref(false)
const detailsPop = ref(false)
const hasHistory = computed(() => drop.value.versions.length > 1)
function showDetails(pop = false) {
  if (editing.value) return
  detailsOpen.value = true
  detailsPop.value = pop
}
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
const reviewDraft = provideReviewDraft(() => drop.value.id)
const siteRef = useTemplateRef<{
  canDraw: boolean
  capturing: boolean
  pending: boolean
}>("siteRef")
const commentsRef = useTemplateRef<{ focusComposer: () => void; focusComment: (id: string) => void }>("commentsRef")
const reviewDock = useTemplateRef<{ focusTrigger: () => void; top: number; toolbar: HTMLElement | null }>("reviewDock")
function showComments() {
  if (!hasComments.value || editing.value) return
  shareOpen.value = false
  tool.value = "browse"
  commentsOpen.value = true
  detailsPop.value = false
}
function closeComments() {
  if (popover.value?.type === "thread") popover.value = null
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
const commentMode = ref(false)
const usage = useUiUsage({
  pill: () => reviewDock.value?.toolbar,
  kind: () => drop.value.kind,
  commenting: () => commentMode.value,
  view: () => drop.value.id,
  hidden: () => Boolean(siteRef.value?.capturing),
})
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
const liveLabels = { connecting: "Connecting", connected: "Live", reconnecting: "Reconnecting" } as const
const liveLabel = (status: ConnectionStatusState) =>
  live.publishing.value && status === "connected" ? "Publishing" : liveLabels[status]

const annotationsEnabled = computed(() => !route.query.changes && !trashed.value)
const variants = shallowRef<ViewerVariants | null>(null)
const prototypeCanvas = computed(() => Boolean(variants.value?.canvas))
let autoShot: File | null = null
const annotations = useViewerAnnotations({
  drop,
  editing,
  enabled: annotationsEnabled,
  canvas: prototypeCanvas,
  onShortcut: usage.key,
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
    autoShot = file
    if (autoShot) images.add([autoShot])
  },
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
const selectionBarRef = useTemplateRef<HTMLElement>("selectionBarRef")
const { width: selectionBarWidth } = useElementSize(selectionBarRef, undefined, { box: "border-box" })
const selectionBarStyle = computed(() => {
  if (!selection.value) return {}
  const { rect } = selection.value
  const half = (selectionBarWidth.value || 180) / 2 + 8
  const center = Math.max(half, Math.min((rect.left + rect.right) / 2, windowWidth.value - half))
  return { left: `${center}px`, top: `${Math.max(56, rect.top - 8)}px` }
})
const commentsShown = useCommentsShown()
overlays.pins = commentsShown.value
watch(
  () => overlays.pins,
  (pins) => (commentsShown.value = pins),
)
const framed = computed(
  () =>
    !editing.value &&
    !["folder", "site", "board", "link"].includes(drop.value.kind) &&
    !video.value &&
    !(drop.value.kind === "file" && !drop.value.html),
)
watch(framed, (value) => !value && (tool.value = "browse"))
const sizable = computed(() => framed.value && !prototypeCanvas.value && ["html", "app"].includes(drop.value.kind))
const dockClearance = computed(
  () =>
    !editing.value &&
    !trashed.value &&
    !video.value &&
    !pdf.value &&
    ["board", "file", "folder"].includes(drop.value.kind),
)
function closeLightbox() {
  lightbox.value = null
  popover.value = null
}
const popoverRef = useTemplateRef<{ fail: (reason?: string, text?: string) => Promise<void> }>("popoverRef")
const shareOpen = ref(false)
watch(shareOpen, (open) => {
  if (!open) return
  detailsPop.value = false
  if (commentsOpen.value) closeComments()
})

useLatestVersion(drop, {
  enabled: () => publicView && !route.query.v && !older.value && !trashed.value && !editing.value,
  busy: () => Boolean(commentsOpen.value || selection.value || lightbox.value || shareOpen.value),
})

const presence = usePresence(drop, {
  at: () => (drop.value.kind === "site" ? null : `v${drop.value.version}${isApp.value ? app.page.value : ""}`),
  enabled: () => !visitor.value && !trashed.value,
})
state.onWrote(() => presence.commented())
function refreshComments() {
  void state.comments.refresh()
  void siteReview?.refresh()
}
watch([presence.commentsChange, presence.notices], () => {
  state.preferPrimaryComments()
  refreshComments()
})
useEventListener("focus", refreshComments)

function startEdit() {
  if (lightbox.value) return
  closeComments()
  popover.value = null
  closeChanges()
  detailsPop.value = false
  void live.open()
}
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

const replaced = (comment: DropComment) => drop.value.kind === "image" && comment.version < drop.value.version
const onPage = (comment: DropComment) =>
  !comment.resolved || (popover.value?.type === "thread" && popover.value.id === comment.id)
const pinned = computed(() =>
  pageComments.value.filter((comment) => onPage(comment) && !replaced(comment) && comment.kind !== "page"),
)

let listBefore = false
function startComment() {
  listBefore = commentsOpen.value
  showComments()
}
watch(popover, (value, before) => {
  if (!before && (value?.type === "new" || value?.type === "thread")) startComment()
  else if (value) showComments()
})
const visibility = createCommentVisibility({ visibility: overlays.pins ? "all" : "hidden" })
const shownWhileHidden = shallowRef<readonly string[]>(visibility.only)
const stopVisibility = visibility.subscribe(() => (shownWhileHidden.value = visibility.only))
onScopeDispose(() => {
  stopVisibility()
  visibility.stop()
})
watch(
  () => overlays.pins,
  (pins) => visibility.set(pins ? "all" : "hidden"),
)
watch(
  () => (commentsOpen.value && popover.value?.type === "thread" ? popover.value.id : null),
  (id) => visibility.open(id),
  { immediate: true },
)
const showSent = (id: string) => visibility.flash(id)
watch(areaMode, (active) => active && showComments())
watch(
  () => siteRef.value?.pending,
  (pending) => pending && startComment(),
)
const commentStyle = useCommentStyle()
const commentStyleModel = computed({
  get: () => (drop.value.kind === "markdown" ? commentStyle.value : undefined),
  set: (value?: CommentStyle) => {
    if (value) commentStyle.value = value
  },
})
const pinStyle = computed(() => commentStyle.value === "pin" && drop.value.kind === "markdown")
const pinOpen = computed(() => commentsOpen.value && !editing.value && !trashed.value && !lightbox.value)
const pinDraft = computed(
  () => pinStyle.value && pinOpen.value && popover.value?.type === "new" && popover.value.pending.kind === "text",
)
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
function dropPinDraft() {
  reviewDraft.body.value = ""
  reviewDraft.images.clear()
  popover.value = null
}
const PIN_BUBBLE_WIDTH = 300
const THREAD_WIDTH = 340
const pinRef = useTemplateRef<HTMLElement>("pinRef")
const { height: bubbleHeight } = useElementSize(pinRef, undefined, { box: "border-box" })
const pinBubbleStyle = computed(() => {
  const spot = pinDraft.value ? undefined : threadSpot.value
  const rect = pinDraft.value ? draftPlace.value?.rect : spot?.rect
  if (!rect) return undefined
  const height = bubbleHeight.value || Math.min(448, windowHeight.value * 0.6)
  const inWindow = (top: number) => Math.max(56, Math.min(top, windowHeight.value - 12 - height))
  if (spot?.rail) {
    const width = Math.min(rect.right - rect.left, windowWidth.value - 24)
    const left = Math.max(12, Math.min(rect.left, windowWidth.value - 12 - width))
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
const floatShown = computed(
  () =>
    !pinStyle.value &&
    !pinThread.value &&
    floating.value &&
    (popover.value?.type !== "new" || popover.value.pending.kind !== "text" || !!draftPlace.value),
)
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
watch(
  () => (popover.value?.type === "new" && popover.value.pending.kind === "text" ? popover.value.pending : null),
  (pending, before) => (pending || before) && send({ type: pending ? "hold-selection" : "clear-selection" }),
)
function toggleCommentArea() {
  if (!canMarkArea.value || editing.value) return
  if (canUseCommentMode.value && !trashed.value) {
    if (commentMode.value) return
    commentMode.value = true
    return true
  }
  const wasOpen = commentsOpen.value
  showComments()
  return !wasOpen && commentsOpen.value
}
if (route.query.changes && hasHistory.value) showDetails(true)

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
const zen = useZen()
const peek = ref(false)
const toggleZen = () => (zen.value = !zen.value)
watch(zen, (on) => on && (detailsOpen.value = false))

const gallery = useGallery(drop, publicView)
const { items: galleryItems, at: galleryAt, prev: prevImage, next: nextImage } = gallery

const pageErrors = ref<DropRuntimeError[]>([])
watch(
  () => drop.value.errors,
  (errors) => (pageErrors.value = errors ?? []),
  { immediate: true },
)
const frame = useTemplateRef<HTMLIFrameElement>("frame")
const { bottom: frameBottom } = useElementBounding(frame)
const { srcdoc, contentOrigin, frameSrc, frameKey, frameScheme, ready, send, unplaced, openPath, picker, whenHeld } =
  useViewerFrame({
    drop,
    frame,
    app,
    pinned,
    inset: ref(0),
    bottom: computed(() => {
      const top = reviewDock.value?.top
      if (prototypeCanvas.value && top && !lightbox.value) return Math.max(0, Math.ceil(frameBottom.value - top))
      return hasComments.value && !trashed.value && !dockClearance.value ? 72 : 0
    }),
    width: docWidth,
    zen,
    annotations,
    clickComments: commentMode,
    threadOverCard: computed(() => Boolean(threadSpot.value?.rail)),
    comments: computed(() => ({
      style: pinStyle.value ? "pin" : "card",
      me: me.value ? { name: me.value.name, image: me.value.image ?? null } : null,
      only: [...shownWhileHidden.value],
    })),
    variantBar: true,
    variants,
    arrow: (key) => galleryShown.value && gallery.step(key === "ArrowLeft" ? -1 : 1),
    presence,
    heading: (id, copySection) => {
      const here = new URL(route.fullPath, link.value)
      here.hash = id
      history.replaceState(history.state, "", `${here.pathname}${here.search}${here.hash}`)
      if (!copySection) return
      const shared = new URL(link.value)
      shared.hash = id
      void copy(shared.href, { announce: "Link to the section copied" })
    },
    docAction: (action) => {
      if (action === "markdown") void copyMarkdown()
      else if (action === "download") download()
      else if (printsPdf.value) exportPdf()
    },
    docIntent: (what) => (what === "markdown" ? sendMarkdown() : void sendFolder()),
    docCopied: (ok, error) => {
      if (!ok) reportClientError("copy", new Error(`The doc header's Copy: ${error ?? "refused"}`))
    },
    openDrop: (id) => void router.push(`/drops/${id}`),
    palette: usePaletteOpener(),
    toggleZen: zenShortcut,
    escape: leaveZen,
    errors: pageErrors,
  })
const canvasShown = computed(() => prototypeCanvas.value && !editing.value && !lightbox.value && !shownVersion.value)
function canvasTool(command: "move" | "hand") {
  if (command === "hand") {
    commentMode.value = false
    if (tool.value !== "browse") tool.value = "browse"
  }
  picker(command)
}
watch(
  () => commentMode.value || tool.value !== "browse",
  (busy) => busy && variants.value?.tool === "hand" && picker("move"),
)
watch(ready, (loaded) => {
  if (!loaded || drop.value.kind !== "markdown") return
  send({ type: "page-link", href: link.value })
  const id = decodeURIComponent(route.hash.slice(1))
  if (id) send({ type: "heading", id })
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
const galleryShown = computed(() => galleryItems.value.length > 0 && !lightbox.value && !shownVersion.value)
let pushedChanges = false
watch(shownVersion, (value) => !value && (pushedChanges = false))
function showVersion(version: DropVersion) {
  if (editing.value) return
  if (shownVersion.value?.version === version.version) return closeChanges()
  const opening = !shownVersion.value
  void setQuery({ changes: version.version }, { push: opening })
  if (opening) pushedChanges = true
  if (phone.value) detailsPop.value = false
}
function closeChanges() {
  if (!shownVersion.value) return
  if (pushedChanges) return router.back()
  void setQuery({ changes: undefined })
}

const presents = computed(() => isApp.value || drop.value.kind === "html")
function openWindow() {
  const query = new URLSearchParams({ present: "" })
  if (older.value) query.set("v", String(drop.value.version))
  if (isApp.value && appAt.value !== "/") query.set("path", appAt.value)
  window.open(`${dropPath(drop.value)}?${query}`, "_blank", "popup")
}
const slidev = computed(
  () => isApp.value && Boolean(drop.value.paths?.some((path) => path.startsWith("assets/slidev/"))),
)
function present() {
  openWindow()
  openPath("/presenter/1")
}

function runShortcut(action: () => unknown) {
  action()
  return true
}
function zenShortcut() {
  usage.key("z", () => runShortcut(toggleZen))
}
defineShortcuts({
  c: () => {
    if (selection.value) return commentOnSelection()
    usage.key("c", () => hasComments.value && !editing.value && !trashed.value && runShortcut(toggleCommentMode))
  },
  e: () => {
    if (selection.value) return commentOnSelection(true)
    usage.key("e", () => !editing.value && showEditTool.value && runShortcut(edit))
  },
  h: () => {
    if (canvasShown.value) return canvasTool("hand")
    usage.key("h", () => hasHistory.value && !editing.value && runShortcut(() => showDetails(true)))
  },
  i: () =>
    usage.key("i", () => {
      if (detailsOpen.value) return runShortcut(() => (detailsOpen.value = false))
      return !editing.value && runShortcut(showDetails)
    }),
  r: () => usage.key("r", toggleCommentArea),
  v: () => {
    tool.value = "browse"
    if (canvasShown.value) canvasTool("move")
  },
  s: () => usage.key("s", () => framed.value && setTool("measure")),
  b: () => usage.key("b", () => canMark.value && annotations.mark("marker")),
  p: () => usage.key("p", () => canMark.value && annotations.mark("pen")),
  a: () => usage.key("a", () => canMark.value && annotations.mark("arrow")),
  t: () => usage.key("t", () => canMark.value && annotations.mark("text")),
  meta_z: () => undoMark(),
  u: () => usage.key("u", () => framed.value && toggleOverlay("rulers")),
  x: () => usage.key("x", () => framed.value && toggleOverlay("xray")),
  l: () => !editing.value && copyLink("Link copied"),
  d: () => usage.key("d", () => !editing.value && Boolean(drop.value.url) && runShortcut(download)),
  m: () =>
    usage.key("m", () => !editing.value && copiesMarkdown.value && runShortcut(() => copyMarkdown("Markdown copied"))),
  w: () => usage.key("w", () => widens.value && runShortcut(nextWidth)),
  z: zenShortcut,
  meta_s: { usingInput: true, handler: () => editing.value && void live.publish() },
})
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
const inLayer = (event: KeyboardEvent) =>
  event.target instanceof Element &&
  Boolean(event.target.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-reka-popper-content-wrapper]'))
onKeyStroke("Escape", (event) => {
  if (event.defaultPrevented || shareOpen.value || lightbox.value || editing.value) return
  if (detailsPop.value) {
    detailsPop.value = false
    return
  }
  if (detailsOpen.value && !popover.value && !commentsOpen.value) {
    if (performance.now() - detailsPopClosedAt > 100) detailsOpen.value = false
    return
  }
  if (!inLayer(event) && leaveZen()) return
  closeChanges()
  if (popover.value) popover.value = null
  else if (commentsOpen.value) closeComments()
  else if (commentMode.value) commentMode.value = false
  annotations.dismiss()
})

function download() {
  if (!drop.value.url) return
  const anchor = document.createElement("a")
  anchor.href = drop.value.url
  anchor.download = drop.value.filename
  anchor.click()
}

const printsPdf = computed(() => drop.value.kind === "markdown" && !editing.value && ready.value)
const exportPdf = () => send({ type: "print", title: drop.value.title })

const copiesMarkdown = computed(() => drop.value.kind === "markdown")

const relatesTo = computed(() =>
  drop.value.kind === "site" || drop.value.resources?.length ? drop.value.id : undefined,
)
const related = ref<RelatedDrop[]>([])
watch(
  () => (drop.value.kind === "markdown" ? relatesTo.value : undefined),
  async (id) => {
    related.value = []
    if (!id) return
    const found = await $fetch<RelatedDrop[]>(`/api/drops/${id}/related`).catch((error: unknown) => {
      reportClientError("related", error, { drop: id })
      return []
    })
    if (relatesTo.value === id) related.value = found
  },
  { immediate: true },
)

function viewsFact(views: { person: number; anonymous: number; agent: number }): DocHeaderFact {
  const total = views.person + views.anonymous + views.agent
  const parts = [
    { icon: "person" as const, n: views.person, tip: `${views.person} by people signed in` },
    { icon: "anonymous" as const, n: views.anonymous, tip: `${views.anonymous} by visitors not signed in` },
    { icon: "agent" as const, n: views.agent, tip: `${views.agent} by agents reading it, yours included` },
  ]
  return {
    icon: "views",
    label: "Views",
    value: total ? `${total} ${total === 1 ? "view" : "views"}` : "No views yet",
    parts: parts.filter((part) => part.n > 0),
  }
}

const droppedBy = computed<DocHeaderWho>(() => {
  const d = drop.value
  const agent = d.versions.find((version) => version.version === d.version)?.agent ?? null
  const harness = agent?.harness ? knownAgent(agent.harness) : null
  const client = d.actorKind === "agent" ? knownAgent(d.actorName) : null
  const shown = harness ?? client
  const origin = import.meta.client ? location.origin : ""
  const label = agent?.harness ?? (client ? d.actorName : undefined)
  const via = d.actorKind === "agent" && label !== d.actorName ? `via ${d.actorName}` : `via ${VIA_LABELS[d.actorKind]}`
  const tip = [via, agent?.model, agent?.reasoningLevel && `${agent.reasoningLevel} reasoning`]
    .filter(Boolean)
    .join(" · ")
  const person = d.owner ?? { name: d.actorName, image: null }
  return {
    name: person.name,
    image: person.image,
    ...(label ? { agent: { label, logo: `${origin}${shown?.logo ?? "/agents/executor.png"}` } } : {}),
    tip,
  }
})

const FOLDER_ROWS = 8
const KIND_ICON: Record<DropKind, DocHeaderKindIcon> = {
  markdown: "doc",
  html: "code",
  app: "code",
  image: "image",
  file: "file",
  board: "file",
  folder: "folder",
  site: "link",
  link: "link",
}
const docFolder = computed(() => {
  const crumb = drop.value.ancestors.at(-1)
  return crumb?.kind === "folder" && me.value ? crumb : null
})
async function sendFolder() {
  const folder = docFolder.value
  if (!folder) return
  const d = drop.value
  const listed = await $fetch<DropSummary[]>("/api/drops", {
    query: { folder: folder.id, limit: FOLDER_ROWS },
  }).catch(() => null)
  if (!listed) return send({ type: "doc-folder-items", folder: null })
  const rows = listed.filter((item) => item.id !== d.id).slice(0, FOLDER_ROWS - 1)
  const items = [...rows, d]
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .map((item) => {
      const time = describeTime(item.updatedAt, { now: now.value, locale: "en-US", style: "short" })
      return {
        id: item.id,
        title: item.title,
        icon: KIND_ICON[item.kind],
        at: time?.label ?? "",
        tip: time?.tip ?? "",
        current: item.id === d.id,
      }
    })
  send({
    type: "doc-folder-items",
    folder: { id: folder.id, title: folder.title, items } satisfies DocHeaderFolder,
  })
}

const docHeader = computed<DocHeader | null>(() => {
  const d = drop.value
  if (d.kind !== "markdown" || editing.value) return null
  const views = d.views
  const folder = d.ancestors.map((crumb) => crumb.title).join(" / ")
  const facts: DocHeaderFact[] = [
    ...(views ? [viewsFact(views)] : []),
    { icon: "file", label: "File", value: d.filename, detail: `Markdown · ${formatBytes(d.size)}` },
    { icon: "person", label: "Dropped by", value: droppedBy.value.name, who: droppedBy.value },
    ...(folder ? [{ icon: "folder" as const, label: "Folder", value: folder, folder: docFolder.value?.id }] : []),
  ]
  const origin = import.meta.client ? location.origin : ""
  return {
    actions: [
      ...(copiesMarkdown.value ? [{ id: "markdown" as const, label: "Copy as Markdown", kbd: "M" }] : []),
      ...(d.url ? [{ id: "download" as const, label: "Download original", kbd: "D" }] : []),
      ...(printsPdf.value ? [{ id: "pdf" as const, label: "Export as PDF" }] : []),
    ],
    facts,
    related: related.value.map((item) => ({
      id: item.id,
      title: item.title,
      href: `${origin}/drops/${item.id}`,
      icon: `${origin}/favicon.ico`,
    })),
  }
})
watch(
  [ready, docHeader],
  ([loaded, header]) => loaded && header && send({ type: "doc-header", ...JSON.parse(JSON.stringify(header)) }),
  { immediate: true },
)

const detailsChip = computed(() => {
  const d = drop.value
  const details = d.kind !== "markdown"
  const size =
    d.kind === "folder"
      ? itemCount(d.items ?? 0)
      : d.kind === "site" || d.kind === "link"
        ? KIND_LABELS[d.kind]
        : formatBytes(d.size)
  const lead = hasHistory.value ? `v${shownVersion.value?.version ?? d.version}` : details ? size : undefined
  if (!lead) return undefined
  const views = details && d.views ? d.views.person + d.views.anonymous + d.views.agent : null
  return views === null ? lead : `${lead} · ${views} ${views === 1 ? "view" : "views"}`
})
const canPin = computed(() => Boolean(me.value) && !trashed.value)
const togglePin = (quiet = false) => void setPinned(drop.value, !drop.value.pinned, { quiet })
const detailsActions = computed<DetailsAction[]>(() => [
  ...(canPin.value
    ? [
        {
          id: "pin",
          label: drop.value.pinned ? "Pinned" : "Pin",
          icon: drop.value.pinned ? "i-mingcute-pin-fill" : "i-mingcute-pin-line",
          pressed: Boolean(drop.value.pinned),
          press: () => togglePin(true),
        },
      ]
    : []),
  ...(drop.value.url && drop.value.kind !== "markdown"
    ? [{ id: "download", label: "Download original", icon: "i-mingcute-download-2-line", kbd: "D", press: download }]
    : []),
  ...(copiesMarkdown.value && !docHeader.value
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
  ...(visitor.value && presents.value && !slidev.value
    ? [{ id: "window", label: "Open in new window", icon: "i-mingcute-external-link-line", press: openWindow }]
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
let markdownLoad: { key: string; text: Promise<string> } | null = null
function markdownText() {
  const d = drop.value
  const key = `${d.id}@${d.version}`
  if (markdownLoad?.key !== key) {
    const text = $fetch<string>(`${dropPath(d)}.md`, { query: { v: d.version }, responseType: "text" })
    markdownLoad = { key, text }
    text.catch(() => {
      if (markdownLoad?.text === text) markdownLoad = null
    })
  }
  return markdownLoad.text
}
const sendMarkdown = () =>
  void markdownText().then(
    (text) => send({ type: "doc-markdown", text }),
    () => send({ type: "doc-markdown", text: null }),
  )
const copyMarkdown = (announce?: string) => copyLoading(markdownText(), { key: "markdown", announce })
watch(
  () => copied("markdown"),
  (on) => on && docHeader.value && send({ type: "doc-copied" }),
)
const feedbackLink = useShareUrl(drop, () =>
  pageErrors.value.length && drop.value.kind === "html" ? drop.value.version : undefined,
)
const feedback = () =>
  feedbackMarkdown(
    drop.value.title,
    feedbackLink.value,
    comments.value,
    drop.value.version,
    drop.value.kind,
    pageErrors.value,
  )
const readerId = computed(
  () =>
    me.value?.id ??
    publishedComments.value.flatMap((comment) => [comment, ...comment.replies]).find((item) => item.mine)?.authorId ??
    "",
)
const waiting = computed(() => waitingForAnswer(publishedComments.value, { me: readerId.value }))
const promptTarget = computed(() => feedbackPromptTarget(drop.value, feedbackLink.value))
const prompt = () =>
  promptMarkdown(promptTarget.value.drop, promptTarget.value.url, waiting.value, pageErrors.value.length)
const threadPrompt = (comment: DropComment) => {
  const thread = waiting.value.find((item) => item.id === comment.id)
  if (thread) return promptMarkdown(promptTarget.value.drop, promptTarget.value.url, [thread])
}
function copyLink(announce?: string) {
  if (owner.value && drop.value.share === "private") return void (shareOpen.value = true)
  const url = new URL(link.value)
  if (isApp.value && appAt.value !== "/") url.searchParams.set("path", appAt.value)
  const shown = variants.value && !editing.value && !lightbox.value && !shownVersion.value ? variants.value : null
  if (shown)
    url.hash = shown.canvas
      ? canvasViewHash(shown.view ?? "", drop.value.version)
      : (shown.variants[shown.current]?.id ?? "")
  void copy(url.href, { key: "link", announce })
}
const canMarkArea = computed(
  () =>
    annotationsEnabled.value &&
    !lightbox.value &&
    (canDrawArea.value || (drop.value.canComment && siteRef.value?.canDraw && !siteRef.value.pending)),
)
const canUseCommentMode = computed(() => framed.value && canDrawArea.value && !shownVersion.value)
const canCommentOnPage = computed(
  () => drop.value.canComment && annotationsEnabled.value && !editing.value && !lightbox.value,
)
watch(canUseCommentMode, (available) => !available && (commentMode.value = false))
const inspectable = computed(
  () => framed.value && annotationsEnabled.value && !lightbox.value && ["html", "app"].includes(drop.value.kind),
)
const canMark = computed(() => framed.value && canDrawArea.value && !shownVersion.value)
const marking = computed(() => tool.value === "mark")
const measurable = computed(() => framed.value && annotationsEnabled.value && !lightbox.value)
const inspectsPage = computed(() => inspectable.value && !prototypeCanvas.value)
const previewTools = computed(() => (inspectsPage.value ? (["measure"] as const) : []))
const previewViews = computed(() => [
  ...(measurable.value ? (["rulers"] as const) : []),
  ...(inspectsPage.value ? (["xray"] as const) : []),
])
const pinnedTools = computed(() => (tool.value === "measure" ? (["measure"] as const) : []))
const pinnedViews = computed(() => previewViews.value.filter((view) => overlays[view]))
function finishMark() {
  if (!marking.value || !annotations.marks.value || annotations.finishing.value) return
  annotations.finishing.value = true
  send({ type: "mark", do: "done" })
}
const undoMark = () => marking.value && send({ type: "mark", do: "undo" })
function colorMark(color: MarkColor) {
  pen.color = color
  send({ type: "pen", tool: pen.tip, color: MARK_COLORS[color] })
}
function sizeMark(index: number) {
  pen.sizes[pen.tip] = index
  send({ type: "pen", tool: pen.tip, width: MARK_TIPS[pen.tip].sizes[index]! })
}
const editNoteOpen = ref(false)
function edit() {
  if (editing.value || !showEditTool.value) return
  if (drop.value.canEdit) startEdit()
  else editNoteOpen.value = true
}
const showEditTool = computed(
  () =>
    !lightbox.value &&
    !shownVersion.value &&
    Boolean(drop.value.canEdit || (drop.value.kind === "markdown" && drop.value.editNote)),
)
watch(shownVersion, (version) => {
  if (version) {
    tool.value = "browse"
    annotations.dismiss()
    commentsOpen.value = false
  }
})

const { submit } = usePinSubmit({
  popover,
  draft: reviewDraft,
  page: () => (isApp.value ? page.value : undefined),
  shown: () => autoShot,
  shotFor: (id) => annotations.shotFor(id),
  ready: () => Boolean(outbox.ready()),
  prepare: () => outbox.writable(),
  addComment: state.addComment,
  closed: () => send({ type: "clear-selection" }),
  sent: showSent,
  fail: async (reason) => {
    await nextTick()
    await popoverRef.value?.fail(reason)
  },
})

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

function copyCommentLink(comment: DropComment) {
  const url = new URL(link.value)
  url.searchParams.set("comment", String(comment.n))
  void copy(url.href, { announce: "Link to the comment copied" })
}
function changesLink(version: DropVersion) {
  const url = new URL(link.value)
  url.searchParams.set("changes", String(version.version))
  return url.href
}

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
  if (comment.at !== null && video.value) {
    await until(videoRef)
      .toBeTruthy({ timeout: 5000 })
      .catch(() => {})
    const still = await videoRef.value?.frameAt(comment.at).catch((error: unknown) => {
      reportClientError("video-frame", error, { drop: drop.value.id })
      return null
    })
    if (!still || popover.value?.type !== "thread" || popover.value.id !== comment.id) return
    showFrame(still)
    popover.value = { type: "thread", id: comment.id, x: 0, y: 0 }
    return
  }
  if (comment.pdfPage !== null && pdf.value) {
    await until(pdfRef)
      .toBeTruthy({ timeout: 5000 })
      .catch(() => {})
    const still = await pdfRef.value?.pageAt(comment.pdfPage).catch((error: unknown) => {
      reportClientError("pdf-page", error, { drop: drop.value.id })
      return null
    })
    if (!still || popover.value?.type !== "thread" || popover.value.id !== comment.id) return
    showPage(still)
    popover.value = { type: "thread", id: comment.id, x: 0, y: 0 }
    return
  }
  await nextTick()
  send({ type: "focus", id: comment.id, open: false })
}

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

const moveTo = useMoveDialog()

const lifetime = useLifetime(() => drop.value)
const INK_CLASSES: Record<MarkColor, string> = {
  pink: "text-pink-500",
  amber: "text-amber-500",
  blue: "text-blue-600",
  green: "text-green-600",
}
const deviceSize = useDeviceSize()
const shownAt = computed(() => {
  const version = shownVersion.value?.version ?? drop.value.version
  return drop.value.versions.find((item) => item.version === version)?.createdAt ?? drop.value.updatedAt
})
usePaletteOffer("drop", dropPalette)
function dropPalette() {
  if (visitor.value) return null
  const title = drop.value.title
  if (editing.value)
    return {
      groups: [
        {
          id: "actions",
          label: title,
          items: [
            {
              label: "Publish the draft",
              icon: "i-mingcute-upload-line",
              kbds: ["meta", "s"],
              onSelect: () => void live.publish(),
            },
          ],
        },
      ],
    }
  if (trashed.value)
    return {
      groups: [
        {
          id: "actions",
          label: title,
          items: owner.value
            ? [{ label: "Restore", icon: "i-mingcute-back-2-line", onSelect: () => void restoreDrop() }]
            : [],
        },
      ],
    }
  const actions: CommandPaletteItem[] = [
    ...(showEditTool.value
      ? [
          {
            label: "Edit together",
            icon: "i-mingcute-pencil-line",
            kbds: ["E"],
            onSelect: usage.palette("edit", () => {
              if (!drop.value.canEdit) showDetails()
              edit()
            }),
          },
        ]
      : []),
    {
      label: "Share…",
      icon: SHARE_ICONS[drop.value.share],
      onSelect: usage.palette("share", () => (shareOpen.value = true)),
    },
    { label: "Copy link", icon: "i-mingcute-link-line", kbds: ["L"], onSelect: () => copyLink("Link copied") },
    ...(canPin.value
      ? [
          drop.value.pinned
            ? { label: "Unpin", icon: "i-mingcute-pin-fill", onSelect: usage.palette("pin", () => togglePin()) }
            : { label: "Pin", icon: "i-mingcute-pin-line", onSelect: usage.palette("pin", () => togglePin()) },
        ]
      : []),
    ...(drop.value.url
      ? [
          {
            label: "Download original",
            icon: "i-mingcute-download-2-line",
            kbds: ["D"],
            onSelect: usage.palette("download", download),
          },
        ]
      : []),
    ...(copiesMarkdown.value
      ? [
          {
            label: "Copy as Markdown",
            icon: "i-mingcute-markdown-line",
            kbds: ["M"],
            onSelect: usage.palette("markdown", () => void copyMarkdown("Markdown copied")),
          },
        ]
      : []),
    ...(printsPdf.value ? [{ label: "Export as PDF", icon: "i-mingcute-pdf-line", onSelect: exportPdf }] : []),
    ...(slidev.value && contentOrigin.value && !lightbox.value && !shownVersion.value
      ? [{ label: "Present", icon: "i-mingcute-presentation-2-line", onSelect: usage.palette("present", present) }]
      : []),
    ...(presents.value && !slidev.value
      ? [
          {
            label: "Open in new window",
            icon: "i-mingcute-external-link-line",
            onSelect: usage.palette("window", openWindow),
          },
        ]
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
      ? [
          {
            label: "Move to Trash",
            icon: "i-mingcute-delete-2-line",
            onSelect: usage.palette("trash", () => void deleteDrop()),
          },
        ]
      : []),
  ]

  const reviewing = hasComments.value && !marking.value
  const listOpen = commentsOpen.value && !popover.value
  const review: CommentStyle | undefined = reviewing ? commentStyleModel.value : undefined
  const commenting: CommandPaletteItem[] = reviewing
    ? [
        ...(canUseCommentMode.value
          ? [
              {
                label: "Comment mode",
                description: "Click or drag on the page to comment there",
                icon: "i-mingcute-chat-3-line",
                kbds: ["C"],
                active: commentMode.value,
                onSelect: usage.palette("comments", toggleCommentMode),
              },
            ]
          : []),
        {
          label: "All comments",
          icon: "i-mingcute-list-check-line",
          kbds: canUseCommentMode.value ? undefined : ["C"],
          active: listOpen,
          onSelect: usage.palette("list", toggleComments),
        },
        ...(canCommentOnPage.value
          ? [
              {
                label: "Comment on the whole page",
                icon: "i-mingcute-file-line",
                onSelect: usage.palette("page", () => void commentOnPage()),
              },
            ]
          : []),
        ...(canMarkArea.value
          ? [
              {
                label: "Comment on an area",
                icon: "i-mingcute-message-1-line",
                kbds: ["R"],
                onSelect: usage.palette("area", toggleCommentArea),
              },
            ]
          : []),
        ...(review
          ? (
              [
                { value: "card", label: "Cards beside the text", icon: "i-mingcute-layout-right-line" },
                { value: "pin", label: "Pins beside the text", icon: "i-mingcute-map-pin-line" },
              ] as const
            ).map((style) => ({
              label: style.label,
              icon: style.icon,
              active: review === style.value,
              onSelect: usage.palette(`style-${style.value}`, () => (commentStyleModel.value = style.value)),
            }))
          : []),
        ...(!lightbox.value && !shownVersion.value && framed.value && pinned.value.length > 0
          ? [
              {
                label: "Hide comments",
                icon: overlays.pins ? "i-mingcute-eye-line" : "i-mingcute-eye-close-line",
                active: !overlays.pins,
                onSelect: usage.palette("pins", () => toggleOverlay("pins")),
              },
            ]
          : []),
      ]
    : []

  const marker: CommandPaletteItem[] =
    hasComments.value && canMark.value && !lightbox.value
      ? [
          // SAFETY: MARK_TIPS is a literal object whose keys are MarkTip; Object.entries widens them to string.
          ...(Object.entries(MARK_TIPS) as [MarkTip, (typeof MARK_TIPS)[MarkTip]][]).map(([id, tip]) => ({
            label: tip.label,
            icon: tip.icon,
            kbds: [tip.key],
            active: marking.value && pen.tip === id,
            onSelect: usage.palette("mark", () => annotations.mark(id)),
          })),
          ...(marking.value
            ? [
                ...Object.entries(INK_CLASSES).map(([name, ink]) => ({
                  label: `${name.charAt(0).toUpperCase()}${name.slice(1)} ink`,
                  icon: "i-mingcute-round-fill",
                  ui: { itemLeadingIcon: ink },
                  active: pen.color === name,
                  // SAFETY: INK_CLASSES is keyed by MarkColor; Object.entries widens its keys to string.
                  onSelect: () => colorMark(name as MarkColor),
                })),
                {
                  label: "Smaller",
                  icon: "i-mingcute-minimize-line",
                  kbds: ["["],
                  onSelect: () => annotations.resize(-1),
                },
                {
                  label: "Larger",
                  icon: "i-mingcute-fullscreen-line",
                  kbds: ["]"],
                  onSelect: () => annotations.resize(1),
                },
                { label: "Undo", icon: "i-mingcute-back-line", kbds: ["meta", "z"], onSelect: undoMark },
                {
                  label: "Done",
                  description: "Send the snapshot and its strokes as a comment",
                  icon: "i-mingcute-check-line",
                  kbds: ["enter"],
                  disabled: !annotations.marks.value || annotations.finishing.value,
                  onSelect: finishMark,
                },
              ]
            : []),
        ]
      : []

  const tooled = hasComments.value && !marking.value && !lightbox.value && !shownVersion.value
  const views: CommandPaletteItem[] = [
    ...(tool.value !== "browse"
      ? [{ label: "Browse", icon: "i-mingcute-cursor-3-line", kbds: ["V"], onSelect: () => (tool.value = "browse") }]
      : []),
    ...(tooled && previewTools.value.length
      ? [
          {
            label: "Measure",
            icon: "i-mingcute-aiming-2-line",
            kbds: ["S"],
            active: tool.value === "measure",
            onSelect: usage.palette("measure", () => setTool("measure")),
          },
        ]
      : []),
    ...(tooled && measurable.value
      ? [
          {
            label: "Rulers and guides",
            icon: "i-mingcute-ruler-line",
            kbds: ["U"],
            active: overlays.rulers,
            onSelect: usage.palette("rulers", () => toggleOverlay("rulers")),
          },
        ]
      : []),
    ...(tooled && inspectsPage.value
      ? [
          {
            label: "X-ray",
            icon: "i-mingcute-layout-grid-line",
            kbds: ["X"],
            active: overlays.xray,
            onSelect: usage.palette("xray", () => toggleOverlay("xray")),
          },
        ]
      : []),
    ...(tooled && (sizable.value || siteRef.value?.canDraw)
      ? [
          {
            label: "Device mode",
            icon: "i-mingcute-device-line",
            active: deviceSize.value.on,
            onSelect: usage.palette(
              "device",
              () => (deviceSize.value = { ...deviceSize.value, on: !deviceSize.value.on }),
            ),
          },
        ]
      : []),
    {
      label: "Zen mode",
      description: "Hide the outline and fold the pill to a handle",
      icon: "i-mingcute-zazen-line",
      kbds: ["Z"],
      active: zen.value,
      onSelect: usage.palette("zen", toggleZen),
    },
    ...(widens.value
      ? widths.map((width) => ({
          label: width.label,
          suffix: "Reading width",
          icon: "i-mingcute-text-line",
          kbds: ["W"],
          active: docWidth.value === width.value,
          onSelect: usage.palette("width", () => (docWidth.value = width.value)),
        }))
      : []),
    ...(presence.people.value.length
      ? [
          {
            label: "Show cursors",
            icon: "i-mingcute-cursor-2-line",
            active: presence.showCursors.value,
            onSelect: () => (presence.showCursors.value = !presence.showCursors.value),
          },
        ]
      : []),
    ...(hasHistory.value
      ? [
          {
            label: "History",
            suffix: `v${shownVersion.value?.version ?? drop.value.version} · ${timeAgo(shownAt.value, now.value)}`,
            icon: "i-mingcute-history-line",
            kbds: canvasShown.value ? undefined : ["H"],
            onSelect: usage.palette("details", () => showDetails(true)),
          },
        ]
      : []),
    {
      label: "Details",
      suffix: [detailsChip.value, `dropped ${timeAgo(drop.value.createdAt, now.value)}`].filter(Boolean).join(" · "),
      icon: "i-mingcute-information-line",
      kbds: ["I"],
      onSelect: usage.palette("details", () => showDetails(Boolean(detailsChip.value))),
    },
  ]

  const folder = lifetime.folder.value
  const lifetimes: CommandPaletteItem[] =
    owner.value && lifetime.choosable.value
      ? [
          ...lifetime.choices.value.map((choice) => ({
            label: choice.label,
            suffix: folder ? `Lifetime of ${folder.title}` : "Lifetime",
            icon: "i-mingcute-time-line",
            active: choice.on,
            disabled: choice.disabled,
            onSelect: choice.select,
          })),
          ...(lifetime.reset.value
            ? [
                {
                  label: lifetime.reset.value.label,
                  suffix: folder ? `Lifetime of ${folder.title}` : "Lifetime",
                  icon: "i-mingcute-refresh-2-line",
                  disabled: lifetime.reset.value.disabled,
                  onSelect: lifetime.reset.value.select,
                },
              ]
            : []),
        ]
      : []

  const prototype = variants.value && !lightbox.value && !shownVersion.value ? variants.value : null
  const camera: CommandPaletteItem[] = prototype
    ? prototype.canvas
      ? [
          {
            label: "Move",
            icon: "i-mingcute-cursor-3-line",
            kbds: ["V"],
            active: (prototype.tool ?? "move") === "move",
            onSelect: () => canvasTool("move"),
          },
          {
            label: "Hand",
            icon: "i-mingcute-hand-line",
            kbds: ["H"],
            active: prototype.tool === "hand",
            onSelect: () => canvasTool("hand"),
          },
          { label: "Zoom out", icon: "i-mingcute-zoom-out-line", kbds: ["−"], onSelect: () => picker("zoom-out") },
          { label: "Zoom in", icon: "i-mingcute-zoom-in-line", kbds: ["+"], onSelect: () => picker("zoom-in") },
          { label: "Fit", icon: "i-mingcute-fullscreen-2-line", kbds: ["shift", "1"], onSelect: () => picker("fit") },
          { label: "Reset zoom", icon: "i-mingcute-refresh-2-line", kbds: ["0"], onSelect: () => picker("reset") },
          { label: "Reset layout", icon: "i-mingcute-layout-grid-line", onSelect: () => picker("layout") },
        ]
      : [
          { label: "Previous item", icon: "i-mingcute-left-line", kbds: ["←"], onSelect: () => picker("prev") },
          { label: "Next item", icon: "i-mingcute-right-line", kbds: ["→"], onSelect: () => picker("next") },
          { label: "Canvas", icon: "i-mingcute-grid-line", kbds: ["Esc"], onSelect: () => picker("canvas") },
        ]
    : []
  const prototypeItems: CommandPaletteItem[] = (prototype?.variants ?? []).map((variant, index) => ({
    label: variant.label || variant.id || `Item ${index + 1}`,
    suffix: variant.note || undefined,
    icon: "i-mingcute-layout-line",
    kbds: index < 9 ? [String(index + 1)] : undefined,
    active: !prototype?.canvas && prototype?.current === index,
    onSelect: () => picker("show", index),
  }))
  const images: CommandPaletteItem[] = galleryShown.value
    ? [
        {
          label: "Previous image",
          icon: "i-mingcute-left-line",
          kbds: ["←"],
          disabled: galleryAt.value <= 0,
          onSelect: () => gallery.step(-1),
        },
        {
          label: "Next image",
          icon: "i-mingcute-right-line",
          kbds: ["→"],
          disabled: galleryAt.value >= galleryItems.value.length - 1,
          onSelect: () => gallery.step(1),
        },
      ]
    : []
  const links: CommandPaletteItem[] = (drop.value.resources ?? []).map((resource) => ({
    label: `Open ${resourceLabel(resource)}`,
    icon: "i-mingcute-external-link-line",
    to: resource.url,
    target: "_blank",
  }))

  return {
    groups: [
      { id: "actions", label: title, items: actions },
      { id: "comments", label: "Comments", items: commenting },
      { id: "marker", label: "Marker", items: marker },
      { id: "view", label: "View", items: views },
      { id: "lifetime", label: "Lifetime", items: lifetimes },
      { id: "prototype", label: "Prototype", items: camera },
      { id: "prototype-items", label: "Prototype items", items: prototypeItems },
      { id: "images", label: "Images in this folder", items: images },
      { id: "links", label: "Links", items: links },
    ],
  }
}

const sameFrame = (comment: DropComment, at: number | undefined, pdfPage: number | undefined) =>
  (at === undefined ? comment.at === null : comment.at !== null && Math.abs(comment.at - at) < 0.05) &&
  (comment.pdfPage ?? undefined) === pdfPage
const imageComments = computed(() =>
  lightbox.value
    ? pageComments.value.filter(
        (comment) =>
          comment.kind !== "text" &&
          comment.selector === lightbox.value!.selector &&
          sameFrame(comment, lightbox.value!.at, lightbox.value!.pdfPage) &&
          !outdated.value.has(comment.id),
      )
    : [],
)

const videoRef = useTemplateRef<{ frameAt: (at?: number) => Promise<VideoFrame | null> }>("videoRef")
const frameComments = computed(() => (video.value ? pageComments.value.filter((comment) => comment.at !== null) : []))
function showFrame(still: VideoFrame) {
  lightbox.value = {
    src: still.src,
    alt: `Frame at ${clock(still.at)}`,
    selector: "video",
    label: `the frame at ${clock(still.at)}`,
    at: still.at,
    file: still.file,
    from: still.rect,
  }
}
const pdfRef = useTemplateRef<{ pageAt: (page?: number) => Promise<PdfPage | null> }>("pdfRef")
const pdfComments = computed(() =>
  pdf.value
    ? pinned.value.filter(
        (comment) => comment.pdfPage !== null && (overlays.pins || shownWhileHidden.value.includes(comment.id)),
      )
    : [],
)
function showPage(still: PdfPage) {
  lightbox.value = {
    src: still.src,
    alt: `Page ${still.page}`,
    selector: "pdf",
    label: `page ${still.page}`,
    pdfPage: still.page,
    file: still.file,
    from: still.rect,
  }
}
provideDropComments({
  source: () => (lightbox.value ? imageComments.value : comments.value),
  page: () => (isApp.value ? page.value : undefined),
})
const threadComment = computed(() => {
  const open = popover.value
  return open?.type === "thread" ? comments.value.find((comment) => comment.id === open.id) : undefined
})
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

const reviewing = computed(
  () =>
    editing.value ||
    tool.value !== "browse" ||
    commentMode.value ||
    commentsOpen.value ||
    Boolean(popover.value) ||
    awaitingSpot.value ||
    Boolean(siteRef.value?.pending) ||
    shareOpen.value ||
    detailsOpen.value ||
    editNoteOpen.value ||
    Boolean(shownVersion.value) ||
    Boolean(lightbox.value),
)
const pillNeeded = computed(() => reviewing.value || Boolean(variants.value && !lightbox.value && !shownVersion.value))
function leaveZen() {
  if (reviewing.value || selection.value) return false
  if (peek.value) peek.value = false
  else if (zen.value) zen.value = false
  else return false
  return true
}
const handleLabel = computed(() => {
  const people = presence.people.value.length
  return [
    "Show tools",
    openCount.value ? `${openCount.value} open ${openCount.value === 1 ? "comment" : "comments"}` : "",
    people ? `${people} ${people === 1 ? "person" : "people"} here` : "",
  ]
    .filter(Boolean)
    .join(", ")
})
watch(
  () => (commentsOpen.value ? threadComment.value?.n : undefined),
  (n) => textValue(route.query.comment) !== (n ? String(n) : undefined) && void setQuery({ comment: n }),
)
</script>

<template>
  <DefineDetails>
    <ViewerOverview
      :drop="drop"
      :facts-in-doc="drop.kind === 'markdown'"
      :show-description="owner || (Boolean(me) && !publicView)"
    />
  </DefineDetails>
  <DefineHistory>
    <LazyViewerHistory :comments="comments" :drop="drop" :selected="shownVersion?.version" @open="showVersion" />
  </DefineHistory>
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
      :agent-prompt="threadPrompt"
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

      <div class="relative flex min-h-0 flex-1 flex-col" :class="dockClearance ? 'pb-28 sm:pb-20' : ''">
        <div class="relative flex min-h-0 flex-1 flex-col">
          <LazyViewerEditor
            v-if="editing"
            :drop-id="drop.id"
            :editor="live.editor.value"
            :publishing="live.publishing.value"
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
          <LazyViewerVideo
            v-else-if="video && drop.url"
            :key="`${drop.id}@${drop.version}:${drop.url}`"
            ref="videoRef"
            :can-comment="drop.canComment && annotationsEnabled && !trashed"
            :comments="frameComments"
            :link="link"
            :src="drop.url"
            :resume="`${drop.id}@${drop.version}`"
            :start="startTime(textValue(route.query.t))"
            :title="drop.title"
            :type="video"
            @frame="showFrame"
            @open="focusComment"
          />
          <LazyViewerPdf
            v-else-if="pdf && drop.url"
            ref="pdfRef"
            :can-comment="drop.canComment && annotationsEnabled && !trashed"
            :comments="pdfComments"
            :src="drop.url"
            :title="drop.title"
            @open="focusComment"
            @page="showPage"
          />
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
            :link="changesLink(shownVersion)"
            :version="shownVersion"
            @close="closeChanges"
          />
        </div>
        <ViewerReviewDock
          ref="reviewDock"
          :class="{ invisible: siteRef?.capturing }"
          :open="commentsOpen && !editing && !trashed && !floating && !awaitingSpot"
          :overlay="Boolean(lightbox)"
          :settle="whenHeld"
          :heading="popover?.type === 'new' || siteRef?.pending ? 'row' : 'none'"
          v-model:peek="peek"
          :folded="zen && !pillNeeded"
          :handle-label="handleLabel"
          title="New comment"
          @close="closeComments"
        >
          <template #handle>
            <DropMark class="h-3.5 w-5" />
            <span v-if="openCount" aria-hidden="true" class="inline-flex items-center gap-0.5">
              <UIcon name="i-mingcute-chat-1-line" class="size-3" />{{ openCount }}
            </span>
            <span v-if="presence.people.value.length" aria-hidden="true" class="flex -space-x-0.5">
              <span
                v-for="person in presence.people.value.slice(0, 3)"
                :key="person.id"
                class="size-1.5 rounded-full ring-1 ring-(--ui-bg)"
                :style="{ backgroundColor: person.color }"
              />
            </span>
          </template>
          <template #panel>
            <ReuseComposer v-if="!floating" />
            <ViewerComments
              v-if="!popover && !siteRef?.pending"
              ref="commentsRef"
              :can-comment="canCommentOnPage"
              :comments="lightbox ? imageComments : comments"
              :outdated="outdated"
              :screenshots="screenshots"
              @focus="focusComment"
            >
              <template #actions>
                <UTooltip v-if="(comments.length || pageErrors.length) && !popover" text="Copy feedback for your agent">
                  <DropCopyButton aria-label="Copy feedback for your agent" size="sm" :value="feedback" />
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
            <template v-if="!editing">
              <UTooltip :text="visitor ? 'Open Drop' : 'Go to your drops'">
                <UButton
                  aria-label="Drop"
                  data-review-home
                  data-usage="home"
                  color="neutral"
                  size="xs"
                  :to="visitor ? '/' : '/drops'"
                  variant="ghost"
                >
                  <DropMark class="h-3.5 w-5" /><span class="hidden sm:inline">Drop</span>
                </UButton>
              </UTooltip>
              <span aria-hidden="true" class="w-1 shrink-0" :class="prototypeCanvas && 'max-sm:hidden'" />
            </template>
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
              <LazyViewerVariants
                :state="variants"
                :version="drop.version"
                @command="
                  (command, index) =>
                    command === 'move' || command === 'hand' ? canvasTool(command) : picker(command, index)
                "
                @view="(hash) => send({ type: 'picker', do: 'view', hash })"
              />
              <span aria-hidden="true" class="w-1 shrink-0" :class="prototypeCanvas && 'max-sm:hidden'" />
            </template>
            <template v-if="editing">
              <AvatarStack
                v-if="live.people.value.length"
                class="ml-1 [&_[data-slot=avatar-stack-item]]:shadow-[0_0_0_2px_var(--vh-avatar-color,var(--ui-border))]"
                :max="3"
                :people="live.people.value"
                :style="{ '--vh-avatar-size': '1.25rem' }"
                variant="outline"
              />
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
                :disabled="!live.synced.value || live.uploading.value"
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
                @color="colorMark"
                @done="finishMark"
                @size="sizeMark"
                @tip="annotations.mark($event)"
                @undo="undoMark"
              />
            </template>
            <template v-else-if="hasComments && !trashed">
              <ViewerToolbar
                v-if="canMark && !lightbox"
                :overlays="overlays"
                :sizable="false"
                :tool="tool"
                :tools="['mark']"
                :views="[]"
                @tool="setTool"
              />
              <UButton
                size="xs"
                v-if="slidev && contentOrigin && !lightbox && !shownVersion"
                color="neutral"
                data-usage="present"
                icon="i-mingcute-presentation-2-line"
                label="Present"
                variant="ghost"
                @click="present"
              />
              <ViewerCommentsSegment
                v-model:on="commentMode"
                v-model:style="commentStyleModel"
                :can-comment="canCommentOnPage"
                :can-use-mode="canUseCommentMode"
                :count="openCount"
                :waiting="deliveryCount"
                :list-open="commentsOpen && !popover"
                :pins="
                  !lightbox &&
                  !shownVersion &&
                  (framed || pdf) &&
                  pinned.length > 0 &&
                  (commentMode || commentsOpen || !overlays.pins)
                "
                :pins-shown="overlays.pins"
                @toggle="toggleCommentMode"
                @list="toggleComments"
                @page="commentOnPage"
                @pins="toggleOverlay('pins')"
              >
                <template #tools>
                  <ViewerCopyPrompt
                    v-if="(pageErrors.length || waiting.length) && !lightbox"
                    :count="waiting.length"
                    :errors="pageErrors.length"
                    :signed-in="Boolean(me)"
                    :value="prompt"
                  />
                </template>
              </ViewerCommentsSegment>
            </template>
            <span
              v-if="editing || (hasComments && !trashed)"
              aria-hidden="true"
              class="w-1 shrink-0"
              :class="prototypeCanvas && 'max-sm:hidden'"
            />
            <template v-if="!editing && presence.people.value.length">
              <ViewerPresence
                v-model:show-cursors="presence.showCursors.value"
                :people="presence.people.value"
                :site="drop.kind === 'site'"
              />
              <span aria-hidden="true" class="w-1 shrink-0" />
            </template>
            <ViewerResources
              v-if="drop.kind !== 'markdown'"
              :related-to="relatesTo"
              :resources="drop.resources ?? []"
            />
            <ViewerShare v-model:open="shareOpen" :drop="drop" />
            <template v-if="!editing">
              <ViewerToolbar
                v-if="!detailsOpen && (pinnedTools.length || pinnedViews.length)"
                :overlays="overlays"
                :sizable="false"
                :tool="tool"
                :tools="pinnedTools"
                :views="pinnedViews"
                @toggle="toggleOverlay"
                @tool="setTool"
              />
              <ViewerDetailsSegment
                v-model:open="detailsOpen"
                v-model:pop="detailsPop"
                :actions="detailsActions"
                :chip="detailsChip"
                :details="drop.kind !== 'markdown'"
                :history="hasHistory"
                :width="widens ? widths.find((item) => item.value === docWidth)?.label : undefined"
                @width="nextWidth"
              >
                <template #tools>
                  <ViewerToolbar
                    v-if="
                      hasComments &&
                      !trashed &&
                      !marking &&
                      !lightbox &&
                      !shownVersion &&
                      (measurable || sizable || siteRef?.canDraw)
                    "
                    :overlays="overlays"
                    :sizable="sizable || Boolean(siteRef?.canDraw)"
                    :tool="tool"
                    :tools="previewTools"
                    :views="previewViews"
                    @toggle="toggleOverlay"
                    @tool="setTool"
                  />
                  <UTooltip
                    v-if="hasComments && !trashed && !marking && showEditTool && drop.canEdit"
                    :kbds="['E']"
                    text="Edit together"
                  >
                    <UButton
                      size="xs"
                      color="neutral"
                      data-usage="edit"
                      icon="i-mingcute-pencil-line"
                      label="Edit"
                      :loading="live.opening.value"
                      variant="ghost"
                      @click="startEdit"
                    />
                  </UTooltip>
                  <LazyViewerEditNote
                    v-else-if="hasComments && !trashed && !marking && showEditTool && drop.editNote"
                    v-model:open="editNoteOpen"
                    :can-comment="drop.canComment"
                    :note="drop.editNote"
                    @copy="copyMarkdown('Markdown copied')"
                  />
                  <UTooltip :kbds="['Z']" text="Zen mode: no outline, the pill folded to a handle">
                    <UButton
                      size="xs"
                      :aria-pressed="zen"
                      color="neutral"
                      data-usage="zen"
                      icon="i-mingcute-zazen-line"
                      label="Zen"
                      variant="ghost"
                      @click="toggleZen"
                    />
                  </UTooltip>
                </template>
                <template v-if="drop.isOwner" #lifetime><ViewerLifetime :drop="drop" /></template>
                <template #details><ReuseDetails /></template>
                <template #history><ReuseHistory /></template>
              </ViewerDetailsSegment>
            </template>
          </template>
        </ViewerReviewDock>
      </div>
    </template>
  </UDashboardPanel>

  <Teleport to="body">
    <section
      v-if="floatShown"
      ref="floatRef"
      aria-label="New comment"
      class="fixed z-40 flex origin-top-left flex-col bg-default motion-safe:[animation:pop-in_150ms_var(--ease-out)]"
      :class="
        compactFloat
          ? 'overflow-visible rounded-[6px_18px_18px_18px] shadow-[0_0_0_1px_rgb(0_0_0/6%),0_2px_4px_rgb(0_0_0/6%),0_10px_24px_-6px_rgb(0_0_0/18%)] dark:shadow-[0_0_0_1px_rgb(255_255_255/10%)] has-[textarea:focus-visible]:shadow-[0_0_0_1px_rgb(0_0_0/22%),0_2px_4px_rgb(0_0_0/6%),0_10px_24px_-6px_rgb(0_0_0/18%)] dark:has-[textarea:focus-visible]:shadow-[0_0_0_1px_rgb(255_255_255/22%)]'
          : 'max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain rounded-lg border border-default shadow-lg'
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
        class="fixed z-40 flex flex-col overscroll-contain border border-default bg-default shadow-lg"
        :class="
          pinDraft && compactFloat
            ? 'overflow-visible rounded-[6px_18px_18px_18px] has-[textarea:focus-visible]:border-accented'
            : pinDraft
              ? 'max-h-[min(28rem,60dvh)] overflow-y-auto rounded-[6px_18px_18px_18px] has-[textarea:focus-visible]:border-accented'
              : threadSpot?.rail
                ? 'max-h-[min(28rem,60dvh)] overflow-hidden rounded-xl'
                : 'max-h-[min(28rem,60dvh)] overflow-hidden rounded-[6px_16px_16px_16px]'
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
      ref="selectionBarRef"
      class="fixed z-30 w-max -translate-x-1/2 -translate-y-full"
      :style="selectionBarStyle"
    >
      <CommentSelectionBar suggest @comment="commentOnSelection()" @suggest="commentOnSelection(true)" />
    </div>
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
