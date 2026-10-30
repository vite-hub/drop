<script setup lang="ts">
// The header locates the drop, the bottom dock owns editing, comments, and sharing, and the right sidebar holds Details and
// History. Frame annotations open their composer or thread in the same review dock.
import type { DocWidth } from "#shared/documents"
import { expiryLabel } from "#shared/expiry"
import { dropPath } from "#shared/links"
import { videoType } from "#shared/plans"
import { resourceLabel } from "#shared/resources"
import { SHARE_ICONS } from "#shared/share"
import type { CommandPaletteItem } from "@nuxt/ui"
import type { DropComment, DropVersion, SiteReviewItem } from "#shared/types"
import { AvatarStack } from "vite-hub/ui/avatar-stack"
import { ConnectionStatus, ConnectionStatusLabel, type ConnectionStatusState } from "vite-hub/ui/connection-status"

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
const [DefineSide, ReuseSide] = createReusableTemplate()
const { width: windowWidth } = useWindowSize()

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

const panel = useViewerPanel({ versions: computed(() => drop.value.versions.length) })
const hasComments = computed(() => drop.value.kind !== "folder")
const commentsOpen = ref(false)
const reviewDraft = provideReviewDraft()
const siteRef = useTemplateRef<{
  canDraw: boolean
  capturing: boolean
  pending: boolean
}>("siteRef")
const commentsRef = useTemplateRef<{ focusComposer: () => void; focusComment: (id: string) => void }>("commentsRef")
const reviewDock = useTemplateRef<{ focusTrigger: () => void }>("reviewDock")
function showComments() {
  if (!hasComments.value || editing.value) return
  shareOpen.value = false
  tool.value = "browse"
  commentsOpen.value = true
  if (!wide.value) panel.close()
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
async function backToComments() {
  const selected = popover.value?.type === "thread" ? popover.value.id : undefined
  popover.value = null
  await nextTick()
  if (selected) commentsRef.value?.focusComment(selected)
  else commentsRef.value?.focusComposer()
}
const { wide, sideOpen, mobileSide, tabs, tab } = panel
const app = useAppFiles(drop)
const { pages, page } = app

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
  reviewOpen: commentsOpen,
  shot: (file) => {
    const { images } = reviewDraft
    const before = images.picks.value.find((pick) => pick.file === autoShot)
    if (before) images.remove(before)
    // A send under way clears the draft when it's done, but not one that changed meanwhile: the picture would stay.
    autoShot = file && !reviewDraft.sending.value ? file : null
    if (autoShot) images.add([autoShot])
  },
})
const {
  selection,
  lightbox,
  popover,
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
/** Whether the drop shows in the frame, where the toolbar's tools work: not an editor, a folder, a site, a board, a video. */
const framed = computed(
  () =>
    !editing.value &&
    !["folder", "site", "board"].includes(drop.value.kind) &&
    !video.value &&
    !(drop.value.kind === "file" && !drop.value.html),
)
watch(framed, (value) => !value && (tool.value = "browse"))
/** Whether the page can show at a device's size (ViewerDevice): HTML docs and apps, not Markdown docs, images, or spreadsheets. */
const sizable = computed(() => framed.value && ["html", "app"].includes(drop.value.kind))
/** Whether the viewer stops above the review dock: boards, sites, apps and files have controls along their bottom edge. */
const dockClearance = computed(
  () => !editing.value && !trashed.value && ["board", "site", "app", "file", "folder"].includes(drop.value.kind),
)
function closeLightbox() {
  lightbox.value = null
  popover.value = null
}
const popoverRef = useTemplateRef<{
  fail: (reason?: string, text?: string) => Promise<void>
  sent: () => Promise<void>
}>("popoverRef")
const shareOpen = ref(false)
watch(shareOpen, (open) => {
  if (open && commentsOpen.value) closeComments()
})

// Someone reading a doc's link (not a pinned or older version) moves to each new version as it's published, unless
// they're commenting, selecting, or sharing. Editors are left out: the live editor tells them itself (useLiveEditor).
useLatestVersion(drop, {
  enabled: () => publicView && !route.query.v && !older.value && !trashed.value && !editing.value,
  busy: () => Boolean(commentsOpen.value || selection.value || lightbox.value || shareOpen.value),
})

function startEdit() {
  if (lightbox.value) return
  closeComments()
  popover.value = null
  closeChanges()
  tab.value = "details"
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
// Comments on the whole page have nothing in it to pin to; they live in the panel.
const pinned = computed(() => pageComments.value.filter((comment) => !replaced(comment) && comment.kind !== "page"))

const panelOpen = computed(() => (wide.value ? sideOpen.value : mobileSide.value))
// The panel's tabs look like T3 Code's: small flat chips, the open one filled, the rest muted until hovered. No
// underline (`after:hidden` covers the one Nuxt UI paints before hydration).
const panelTabsUi = {
  list: "gap-1 border-0 mb-0 p-0",
  indicator: "hidden",
  trigger:
    "h-6 gap-1 rounded-md py-0 pr-2 pl-1.5 font-normal after:hidden data-[state=active]:bg-elevated data-[state=active]:text-highlighted hover:data-[state=inactive]:not-disabled:bg-elevated/60 hover:data-[state=inactive]:not-disabled:text-highlighted",
  leadingIcon: "size-3.5",
}
const has = (value: "history" | "details") => tabs.value.some((item) => item.value === value)
function toggleDetails() {
  if (panelOpen.value) panel.close()
  else {
    if (!wide.value) closeComments()
    panel.show("details")
  }
}
watch(mobileSide, (open) => open && closeComments())
watch(popover, (value) => value && showComments())
watch(areaMode, (active) => active && showComments())
watch(
  () => siteRef.value?.pending,
  (pending) => pending && showComments(),
)
function toggleCommentArea() {
  if (canMarkArea.value) showComments()
}
// A `?changes=` link opens with History beside the diff, as if the version had been picked there.
if (route.query.changes && has("history")) {
  tab.value = "history"
  sideOpen.value = true
}
const docked = computed(() => sideOpen.value && wide.value && tabs.value.length > 0)

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
const { srcdoc, contentOrigin, frameSrc, frameKey, ready, send, unplaced, openPath, variants, picker, whenHeld } =
  useViewerFrame({
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
    variantBar: true,
    arrow: (key) => galleryShown.value && gallery.step(key === "ArrowLeft" ? -1 : 1),
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
/** Picking the open version again goes back to the document. Below `lg` the panel is a slideover, so it steps aside. */
function showVersion(version: DropVersion) {
  if (editing.value) return
  if (shownVersion.value?.version === version.version) return closeChanges()
  const opening = !shownVersion.value
  void setQuery({ changes: version.version }, { push: opening })
  if (opening) pushedChanges = true
  if (!wide.value) mobileSide.value = false
}
function closeChanges() {
  if (!shownVersion.value) return
  if (pushedChanges) return router.back()
  void setQuery({ changes: undefined })
}
// The diff belongs to History: another tab goes back to the document.
watch(tab, (value) => value !== "history" && closeChanges())

// Apps and HTML pages open alone in another window (ViewerPresent): a deck for the projector, which Slidev's presenter
// view in this frame then drives.
const presents = computed(() => isApp.value || drop.value.kind === "html")
function openWindow() {
  const query = new URLSearchParams({ present: "" })
  if (older.value) query.set("v", String(drop.value.version))
  if (isApp.value && page.value !== "index.html") query.set("file", page.value)
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
  c: showComments,
  e: () => {
    if (editing.value || !showEditTool.value) return
    if (drop.value.canEdit) startEdit()
    else editNoteOpen.value = true
  },
  h: () => !editing.value && has("history") && panel.show("history"),
  i: () => !editing.value && has("details") && panel.show("details"),
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
  if (event.defaultPrevented || mobileSide.value || shareOpen.value || lightbox.value || editing.value) return
  closeChanges()
  if (popover.value) popover.value = null
  else if (commentsOpen.value) closeComments()
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

// The version on screen, as the server converts it (server/middleware/0.09.drop-markdown.ts): the same text agents get.
const copiesMarkdown = computed(() => drop.value.kind === "markdown" || drop.value.kind === "html")
const copyMarkdown = (announce?: string) =>
  copyLoading(
    $fetch<string>(`${dropPath(drop.value)}.md`, { query: { v: drop.value.version }, responseType: "text" }),
    { key: "markdown", announce },
  )
const copyFeedback = () =>
  copy(feedbackMarkdown(drop.value.title, link.value, comments.value, drop.value.version), { key: "feedback" })
// A private drop has no working link yet, so its owner gets Share instead; a teammate's still copies.
function copyLink(announce?: string) {
  if (owner.value && drop.value.share === "private") shareOpen.value = true
  else void copy(link.value, { key: "link", announce })
}
const canMarkArea = computed(
  () =>
    annotationsEnabled.value &&
    !lightbox.value &&
    (canDrawArea.value || (drop.value.canComment && siteRef.value?.canDraw && !siteRef.value.pending)),
)
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
async function submit(body: string, files: File[] = []) {
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

/** A comment on the page as a whole, from the box at the bottom of the Comments panel. On an app, the page showing. */
const addPageComment = (body: string, files: File[] = []) =>
  state.addComment(
    { kind: "page", selector: "", ox: 0, oy: 0, ow: 0, oh: 0, ...(isApp.value ? { page: page.value } : {}) },
    body,
    files,
  )

async function resolve(id: string, resolved: boolean) {
  popover.value = null
  await state.resolveComment(id, resolved)
}

async function removeComment(id: string) {
  popover.value = null
  await state.removeComment(id)
}

async function reply(id: string, body: string, files: File[] = []) {
  const composer = popoverRef.value
  const sent = await state.addReply(id, body, files)
  if (popoverRef.value !== composer) return
  if ("value" in sent) await composer?.sent()
  else await composer?.fail(sent.error, body)
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
  if (comment.kind !== "page") send({ type: "focus", id: comment.id, open: false })
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
    ...(has("history")
      ? [{ label: "History", icon: "i-mingcute-history-line", kbds: ["h"], onSelect: () => panel.show("history") }]
      : []),
    ...(has("details")
      ? [{ label: "Details", icon: "i-mingcute-information-line", kbds: ["i"], onSelect: () => panel.show("details") }]
      : []),
    { label: "Copy link", icon: "i-mingcute-link-line", kbds: ["l"], onSelect: () => copyLink("Link copied") },
    ...(drop.value.url
      ? [{ label: "Download", icon: "i-mingcute-download-2-line", kbds: ["d"], onSelect: download }]
      : []),
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
const threadComment = computed(() => {
  const open = popover.value
  return open?.type === "thread" ? comments.value.find((comment) => comment.id === open.id) : undefined
})
// The open thread stays in the address (`?comment=<n>`, read above), so it can be shared from the address bar too.
watch(
  () => (commentsOpen.value ? threadComment.value?.n : undefined),
  (n) => textValue(route.query.comment) !== (n ? String(n) : undefined) && void setQuery({ comment: n }),
)
</script>

<template>
  <DefineSide>
    <div class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-default px-2">
      <UTabs
        v-model="tab"
        color="neutral"
        :content="false"
        :items="tabs.map((item) => ({ ...item, disabled: editing && item.value === 'history' }))"
        size="xs"
        :ui="panelTabsUi"
        variant="link"
      />
      <UButton
        aria-label="Close details and history"
        color="neutral"
        icon="i-mingcute-close-line"
        size="sm"
        variant="ghost"
        @click="panel.close"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <ViewerHistory
        v-if="tab === 'history'"
        :comments="comments"
        :drop="drop"
        :selected="shownVersion?.version"
        @open="showVersion"
      />
      <ViewerOverview v-else :drop="drop" :show-description="owner || (Boolean(me) && !publicView)">
        <template #actions>
          <div v-if="widens" class="space-y-2 px-2 pb-4">
            <label for="drop-reading-width" class="text-xs font-medium text-muted">Reading width</label>
            <USelect id="drop-reading-width" v-model="docWidth" class="w-full" :items="widths" />
          </div>
          <ViewerAction v-if="drop.url" icon="i-mingcute-download-2-line" label="Download original" @click="download" />
          <ViewerAction
            v-if="copiesMarkdown"
            :icon="copied('markdown') ? 'i-mingcute-check-line' : 'i-mingcute-markdown-line'"
            :label="copied('markdown') ? 'Copied' : 'Copy as Markdown'"
            @click="copyMarkdown()"
          />
          <ViewerAction
            v-if="presents && !slidev"
            icon="i-mingcute-external-link-line"
            label="Open in new window"
            @click="openWindow"
          />
          <ViewerAction
            v-if="owner && !trashed"
            icon="i-mingcute-new-folder-line"
            label="Move to folder"
            @click="moveTo({ drop })"
          />
          <NuxtLink
            v-if="visitor"
            class="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted hover:bg-elevated"
            :to="{ path: '/report', query: { target: `/d/${drop.link}` } }"
          >
            <UIcon name="i-mingcute-flag-1-line" class="size-4" />Report
          </NuxtLink>
          <div v-if="drop.canTrash && !trashed" class="mt-2 border-t border-default pt-2">
            <ViewerAction destructive icon="i-mingcute-delete-2-line" label="Move to Trash" @click="deleteDrop" />
          </div>
        </template>
      </ViewerOverview>
    </div>
  </DefineSide>

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
          <ViewerResources v-if="drop.resources?.length" :resources="drop.resources" />
        </template>
        <template #right>
          <UTooltip text="Details and history" :kbds="['I']">
            <UButton
              aria-label="Details and history"
              :aria-expanded="panelOpen"
              aria-controls="drop-details"
              color="neutral"
              icon="i-mingcute-layout-right-line"
              :variant="panelOpen ? 'soft' : 'ghost'"
              @click="toggleDetails"
            />
          </UTooltip>
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
          <span class="truncate">{{ drop.slug || drop.link }}/{{ page === "index.html" ? "" : page }}</span>
        </span>
        <USelect v-if="pages.length > 1" v-model="page" class="w-40 font-mono" :items="pages" size="xs" />
      </div>

      <!-- Documents, HTML docs and images run under the glass; Markdown and the live editor already have trailing room.
           Interactive viewers need clearance so their bottom controls stay clickable. -->
      <div class="relative flex min-h-0 flex-1 flex-col" :class="dockClearance ? 'pb-28 sm:pb-20' : ''">
        <div class="relative flex min-h-0 flex-1 flex-col">
          <LazyViewerEditor v-if="editing" :editor="live.editor.value" :synced="live.synced.value" :width="docWidth" />
          <ViewerFolder v-else-if="drop.kind === 'folder'" :drop="drop" :public-view="publicView" />
          <ViewerSite
            v-else-if="drop.kind === 'site'"
            ref="siteRef"
            :drop="drop"
            :reviewing="commentsOpen && drop.canComment && annotationsEnabled && !editing"
          />
          <LazyViewerBoard v-else-if="drop.kind === 'board'" :key="drop.id" :drop="drop" />
          <ViewerVideo v-else-if="video && drop.url" :src="drop.url" :title="drop.title" :type="video" />
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
              class="block min-h-0 w-full flex-1 bg-default [color-scheme:light]"
              :allow="frameAllow(drop.kind)"
              :sandbox="CONTENT_SANDBOX"
              :src="frameSrc"
              :title="drop.title"
            />
            <!-- [color-scheme:light] on both frames matches a blank or light document, so the browser paints no opaque white
               backdrop behind it in dark mode. -->
            <!-- Hydration mismatch reason: SSR/client bundlers format the srcdoc resolver differently. -->
            <iframe
              v-else
              ref="frame"
              class="block min-h-0 w-full flex-1 bg-default [color-scheme:light]"
              data-allow-mismatch="attribute"
              :allow="frameAllow(drop.kind)"
              :sandbox="PREVIEW_SANDBOX"
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

          <ViewerDiff
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
          :open="commentsOpen && !editing && !trashed"
          :overlay="Boolean(lightbox)"
          :settle="whenHeld"
          @close="closeComments"
        >
          <template #heading>
            <span class="text-sm font-medium">{{
              popover?.type === "new" || siteRef?.pending ? "New comment" : "Comments"
            }}</span>
            <UTooltip v-if="comments.length && !popover" text="Copy feedback for your agent">
              <UButton
                aria-label="Copy feedback for your agent"
                color="neutral"
                :icon="copied('feedback') ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
                size="sm"
                variant="ghost"
                @click="copyFeedback"
              />
            </UTooltip>
          </template>
          <template #panel>
            <div id="drop-site-composer" v-show="siteRef?.pending" class="flex min-h-0 flex-1 flex-col" />
            <ViewerCommentThread
              v-if="popover && !siteRef?.pending"
              :key="popover.type === 'thread' ? popover.id : 'new'"
              ref="popoverRef"
              :can-manage="drop.isOwner"
              :comment="threadComment"
              :screenshot="threadComment ? screenshots.get(threadComment.id) : undefined"
              :pending="popover.type === 'new' ? popover.pending : undefined"
              :draft="popover.type === 'new' ? popover.body : undefined"
              :draft-error="popover.type === 'new' ? popover.error : undefined"
              :can-reply="drop.canComment"
              @cancel="backToComments"
              @copy-link="copyCommentLink"
              @delete="removeComment"
              @delete-reply="(id, replyId) => state.removeReply(id, replyId)"
              @reply="reply"
              @resolve="resolve"
              @submit="submit"
            />
            <ViewerComments
              v-else-if="!siteRef?.pending"
              ref="commentsRef"
              :can-comment="drop.canComment && !shownVersion && !lightbox"
              :can-manage="drop.isOwner"
              :comments="lightbox ? imageComments : comments"
              :screenshots="screenshots"
              :add-page-comment="addPageComment"
              :outdated="outdated"
              :version="drop.version"
              :versions="drop.versions"
              @focus="focusComment"
              @resolve="resolve"
            />
          </template>
          <template #toolbar>
            <template v-if="galleryShown">
              <ViewerGallery
                :at="galleryAt"
                :items="galleryItems"
                :to="gallery.to"
                @show="gallery.show"
                @step="gallery.step"
              />
              <span aria-hidden="true" class="mx-0.5 h-[18px] w-px shrink-0 bg-(--ui-border)" data-divider />
            </template>
            <template v-if="variants && !editing && !lightbox && !shownVersion">
              <ViewerVariants :state="variants" @command="picker" />
              <span aria-hidden="true" class="mx-0.5 h-[18px] w-px shrink-0 bg-(--ui-border)" data-divider />
            </template>
            <template v-if="editing">
              <AvatarStack
                v-if="live.people.value.length"
                :max="3"
                :people="live.people.value"
                :style="{ '--vh-avatar-size': '1.25rem' }"
                variant="outline"
              />
              <ConnectionStatus
                class="px-2 text-xs text-muted data-[status=reconnecting]:text-error"
                :status="live.status.value"
              >
                <ConnectionStatusLabel v-slot="{ state: connection }">{{
                  liveLabel(connection)
                }}</ConnectionStatusLabel>
              </ConnectionStatus>
              <UButton size="xs" color="neutral" label="Close" variant="ghost" @click="live.close" />
              <UButton
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
              <ViewerMarkTools
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
              <ViewerEditNote
                v-else-if="showEditTool && drop.editNote"
                v-model:open="editNoteOpen"
                :can-comment="drop.canComment"
                :note="drop.editNote"
                @copy="copyMarkdown('Markdown copied')"
              />
              <UButton
                size="xs"
                data-review-trigger
                :aria-label="openCount ? `Comments, ${openCount} open` : 'Comments'"
                :aria-expanded="commentsOpen"
                aria-controls="drop-comments"
                color="neutral"
                icon="i-mingcute-chat-3-line"
                :variant="commentsOpen ? 'soft' : 'ghost'"
                @click="toggleComments"
              >
                Comments
                <span
                  v-if="openCount && !commentsOpen"
                  class="rounded bg-elevated px-1 text-[10px] leading-[17px] tabular-nums"
                  >{{ openCount }}</span
                >
              </UButton>
            </template>
            <span
              v-if="editing || (hasComments && !trashed)"
              aria-hidden="true"
              class="mx-0.5 h-[18px] w-px shrink-0 bg-(--ui-border)"
              data-divider
            />
            <ViewerShare v-model:open="shareOpen" :drop="drop" />
          </template>
        </ViewerReviewDock>
      </div>
    </template>
  </UDashboardPanel>
  <!-- Beside the page, full height, like T3 Code's right panel: it pushes the content instead of covering it. The page's
       right border divides them, and the handle on it resizes the panel; double-click resets it. -->
  <template v-if="docked">
    <UDashboardResizeHandle
      tabindex="0"
      aria-label="Resize details sidebar"
      aria-orientation="vertical"
      :aria-valuenow="panel.width.value"
      :aria-valuemin="20"
      :aria-valuemax="36"
      class="focus-visible:outline-2 focus-visible:outline-inverted"
      @keydown="panel.resize.key"
      @dblclick="panel.resize.reset"
      @lostpointercapture="panel.resize.end"
      @pointerdown="panel.resize.start"
      @pointermove="panel.resize.move"
    />
    <UDashboardPanel
      id="drop-side"
      class="flex-none lg:w-(--width)"
      :style="{ '--width': `${panel.width.value}rem` }"
      :ui="{ body: 'p-0 sm:p-0 gap-0 sm:gap-0 overflow-hidden' }"
    >
      <template #body>
        <div id="drop-details" class="flex min-h-0 flex-1 flex-col"><ReuseSide /></div>
      </template>
    </UDashboardPanel>
  </template>
  <USlideover v-if="!wide" v-model:open="mobileSide" side="right" :ui="{ content: 'max-w-md' }" title="Drop panel">
    <template #content>
      <div class="flex h-full flex-col">
        <div id="drop-details" class="flex min-h-0 flex-1 flex-col"><ReuseSide /></div>
      </div>
    </template>
  </USlideover>

  <!-- On <body>: as the dashboard's last child they'd put the panel's lg:not-last:border-e on it, and the doc would
       shift a pixel whenever text is selected. -->
  <Teleport to="body">
    <div
      v-if="selection && (!commentsOpen || !popover)"
      class="fixed z-30 -translate-x-1/2 -translate-y-full"
      :style="{
        left: `${Math.min(Math.max(60, (selection.rect.left + selection.rect.right) / 2), windowWidth - 60)}px`,
        top: `${Math.max(56, selection.rect.top - 8)}px`,
      }"
    >
      <div
        class="flex origin-bottom items-center rounded-md border border-default bg-default p-0.5 shadow-sm [animation:pop-in_140ms_var(--ease-out)]"
      >
        <UButton
          color="neutral"
          icon="i-mingcute-chat-1-line"
          label="Comment"
          size="sm"
          variant="ghost"
          @click="commentOnSelection"
          @mousedown.prevent
        />
      </div>
    </div>

    <ViewerLightbox
      v-if="lightbox"
      :alt="lightbox.alt"
      :can-comment="drop.canComment"
      :comments="imageComments"
      :draft="imageDraft"
      :from="lightbox.from"
      :src="lightbox.src"
      @close="closeLightbox"
      @pick="pickImage"
      @thread="(id, x, y) => (popover = { type: 'thread', id, x, y })"
    />
  </Teleport>
</template>
