<script setup lang="ts">
// The drop viewer (T3 Code's layout): a main column with its own header, and one panel with tabs (Comments,
// Details) that floats over the content, Mesurer-style. Docs and apps share it. People review and comment, agents
// publish new versions, and people who may edit a Markdown doc edit it together live (useLiveEditor). State lives in
// composables (useDrop, useViewerPanel, useAppFiles, useDropFrame, useLiveEditor); this file wires them up.
import { planDocument } from "#shared/documents"
import { expiryLabel } from "#shared/expiry"
import { dropPath } from "#shared/links"
import { injectRuntime } from "#shared/plan-runtime"
import type { PlanKind } from "#shared/plans"
import { buildProjectDocument, pageAt, pageUrl } from "#shared/project-bundle"
import { SHARE_ICONS } from "#shared/share"
import type { DropComment, DropVersion } from "#shared/types"
import { until } from "@vueuse/core"
import { AvatarStack } from "vite-hub/ui/avatar-stack"
import { ConnectionStatus, ConnectionStatusLabel, type ConnectionStatusState } from "vite-hub/ui/connection-status"
import type { SideTab } from "~/utils/viewer"
import type { PendingComment } from "./viewer/ViewerCommentPopover.vue"
import type { Area } from "./viewer/ViewerLightbox.vue"

type Rect = { left: number; top: number; right: number; bottom: number }
type Selection = { quote: string; selector: string; label: string; rect: Rect }
type Lightbox = { src: string; alt: string; selector: string; label: string; from?: { left: number; top: number; width: number; height: number } }
type Popover = { x: number; y: number } & ({ type: "new"; pending: PendingComment } | { type: "thread"; id: string })

const props = withDefaults(defineProps<{ publicView?: boolean }>(), { publicView: false })

const state = injectDrop()!
const drop = computed(() => state.drop.data.value!)
const comments = computed(() => state.comments.data.value)

const route = useRoute()
const notify = useNotify()
const { copy } = useCopy()
const { remove, restore } = useDropActions()
const colorMode = useColorMode()
const mounted = useMounted()
const dark = computed(() => colorMode.value === "dark")
const [DefineSide, ReuseSide] = createReusableTemplate()
const { width: windowWidth } = useWindowSize()

const isApp = computed(() => drop.value.kind === "app")
// The owner gets their controls on the public link too: it is where they land after sharing it.
const owner = computed(() => drop.value.isOwner)
// Signed-in people read a public link inside the app, sidebar included (pages/d/[id]/[[slug]].vue); visitors see it alone.
const { data: me } = useMe()
const visitor = computed(() => props.publicView && !me.value)
const openCount = computed(() => comments.value.filter(comment => !comment.resolved).length)
const link = useShareUrl(drop)
const now = useRelativeNow()
const trashed = computed(() => drop.value.trashedAt !== null)
// A doc's link opens its latest version. Someone reading an earlier one, pinned (`?v=`) or from History, can go to the
// latest; someone whose old link moved them to the latest (`?from=`) can go back to the version they were sent.
const latest = computed(() => drop.value.versions[0] ?? drop.value)
const older = computed(() => latest.value.id !== drop.value.id)
const latestTo = computed(() => (props.publicView ? dropPath(drop.value) : `/drops/${latest.value.id}`))
const sentVersion = computed(() => {
  const version = Number(route.query.from)
  return props.publicView && !older.value && version > 0 && version < drop.value.version ? version : 0
})
const sentNotice = ref(true)
const restoring = ref(false)
async function restoreDrop() {
  restoring.value = true
  await restore(drop.value)
  restoring.value = false
}

// A folder's description (what goes in it) is in Details, for everyone signed in who adds to it.
const details = computed(() => owner.value || (drop.value.kind === "folder" && Boolean(drop.value.note && me.value) && !props.publicView))
const panel = useViewerPanel({ details, openCount, versions: computed(() => drop.value.versions.length), comments: computed(() => drop.value.kind !== "folder") })
const { wide, sideOpen, mobileSide, tabs, tab } = panel
const { files, pages, page } = useAppFiles(drop)

const live = useLiveEditor(drop, { publicView: props.publicView })
const editing = live.editing
// ConnectionStatus waits 1.5 s before it says Reconnecting: a dropped socket usually comes back sooner, and Yjs keeps
// the edits meanwhile.
const liveLabels = { connecting: "Connecting", connected: "Live", reconnecting: "Reconnecting" } as const
const liveLabel = (state: ConnectionStatusState) => (live.publishing.value && state === "connected" ? "Publishing" : liveLabels[state])
function startEdit() {
  popover.value = selection.value = null
  void live.open()
}
// Both pages key this viewer by the drop's id, so another version (a teammate's "Open", the sidebar) mounts a new one;
// the old one leaves its draft's room as it unmounts (useLiveEditor).
onMounted(() => {
  if (route.query.edit === "1" && drop.value.canEdit) startEdit()
})

// Images load into the sandbox as data URLs: the opaque-origin frame can't send your session cookie.
const imageBlob = shallowRef<Blob>()
const { base64: imageData } = useBase64(imageBlob)
onMounted(async () => {
  if (drop.value.kind !== "image" || !drop.value.url) return
  imageBlob.value = await $fetch<Blob>(drop.value.url, { responseType: "blob" }).catch(() => undefined)
})

const attached = useAttachmentData(drop)

// A plain variable, not a ref: the documents read it when they're built, and opening the panel later must not
// rebuild (and reload) them. The "inset" message moves the text from there (set below, with `floating`).
let startInset = 0
const appDocument = (path: string) => injectRuntime(buildProjectDocument(files.value, path), dark.value, startInset)
// Built only once mounted: the server can't know the reader's color mode, and a light document in a dark page paints
// the frame white until the dark one replaces it. The panel's room goes in too (startInset), so a doc opened with the
// panel showing doesn't slide left once it loads.
const srcdoc = computed(() => {
  if (!mounted.value || drop.value.kind === "folder") return ""
  if (isApp.value) return appDocument(page.value)
  if (drop.value.kind === "image") return imageData.value ? planDocument("image", imageData.value, dark.value, "", startInset) : ""
  if (!attached.ready.value) return ""
  return planDocument(drop.value.kind as PlanKind, attached.inline(drop.value.content ?? ""), dark.value, attached.inline(drop.value.html ?? ""), startInset)
})

// With a content origin, apps and HTML docs load its frame host at the page's own URL, and the document follows over
// postMessage (see server/utils/content-origin.ts). Otherwise the document is the iframe's srcdoc, in an opaque origin.
const contentOrigin = computed(() => drop.value.contentOrigin)
const frameSrc = ref<string>()
const frameKey = ref(0)
/** The document the content frame shows. When the frame moves on its own, the viewer follows without a reload. */
let frameDocument = ""
function reloadFrame() {
  frameSrc.value = contentOrigin.value ? contentOrigin.value + (isApp.value ? pageUrl(page.value) : "/") : undefined
  frameKey.value++
}
onMounted(reloadFrame)

function pageFor(path: string) {
  let decoded = path
  try { decoded = decodeURIComponent(path) }
  catch {}
  return pageAt(pages.value, decoded)
}

/** A path no page matches gets 404.html, or index.html for single-page apps, like a static host. */
const fallbackDocument = () => appDocument("404.html" in files.value ? "404.html" : "index.html")

/** The content frame navigated by itself (a link, history.pushState, a reload): show the page it landed on. */
function followFrame(path: string) {
  if (!isApp.value) return true
  const target = pageFor(path)
  if (target) page.value = target
  return target !== null
}

const frame = useTemplateRef<HTMLIFrameElement>("frame")
const selection = ref<Selection | null>(null)
const lightbox = ref<Lightbox | null>(null)
const popover = ref<Popover | null>(null)
const popoverRef = useTemplateRef<{ fail: () => void; sent: () => Promise<void> }>("popoverRef")
const shareOpen = ref(false)

const pageComments = computed(() => (isApp.value ? comments.value.filter(comment => comment.page === page.value || (!comment.page && page.value === pages.value[0])) : comments.value))

// Open comments carry over from earlier versions (server/utils/comments.ts). One is outdated when this version no
// longer has what it pointed at: the frame couldn't find its text or element (it says which), or the drop is an image,
// where every version is a new picture.
// TODO(apps): apps replace their files in place, so their comments all count as this version's and never go
// outdated. That needs app versions kept (see publishApp in server/utils/drops.ts).
const unplaced = ref(new Set<string>())
const replaced = (comment: DropComment) => drop.value.kind === "image" && comment.version < drop.value.version
const outdated = computed(() => new Set(comments.value.filter(comment => comment.version < drop.value.version && (replaced(comment) || unplaced.value.has(comment.id))).map(comment => comment.id)))
/** The version whose changes show in place of the document (ViewerDiff), and the one before it. */
const shownVersion = ref<DropVersion | null>(null)
const previousVersion = computed(() => (shownVersion.value ? drop.value.versions[drop.value.versions.findIndex(item => item.id === shownVersion.value!.id) + 1] ?? null : null))
/** Picking the open version again goes back to the document. Below `lg` the panel is a slideover, so it steps aside. */
function showVersion(version: DropVersion) {
  shownVersion.value = shownVersion.value?.id === version.id ? null : version
  if (shownVersion.value && !wide.value) mobileSide.value = false
}
// The diff belongs to History: another tab goes back to the document.
watch(tab, value => value !== "history" && (shownVersion.value = null))

// What the page reports going wrong goes to the server in batches, for the agent's read_drop. Only apps and HTML pages
// run their own code; a Markdown doc's errors would be Drop's.
type RuntimeReport = { kind: string; message: string; source?: string; page?: string }
let runtimeReports: RuntimeReport[] = []
const flushRuntimeReports = useDebounceFn(() => {
  const errors = runtimeReports.splice(0, 20)
  runtimeReports = []
  if (errors.length) $fetch(`/api/drops/${drop.value.id}/errors`, { method: "POST", body: { version: drop.value.version, errors } }).catch(() => {})
}, 2000)

const { ready, send } = useDropFrame(frame, contentOrigin, (frameMessage, rect) => {
  const message = frameMessage
  if (message.type === "runtime-error") {
    if ((isApp.value || drop.value.kind === "html") && !trashed.value && message.message) {
      runtimeReports.push({ kind: message.kind, message: String(message.message).slice(0, 500), source: message.source?.slice(0, 300), ...(isApp.value ? { page: page.value } : {}) })
      void flushRuntimeReports()
    }
    return
  }
  if (message.type === "host") {
    frameDocument = followFrame(message.path) ? srcdoc.value : fallbackDocument()
    send({ type: "document", html: frameDocument })
  }
  if (message.type === "frame-request" && isApp.value) {
    const target = pageFor(message.path)
    send({ type: "document", id: message.id, html: target ? appDocument(target) : fallbackDocument() })
  }
  if (message.type === "location" && followFrame(message.path)) frameDocument = srcdoc.value
  if (message.type === "navigate" && isApp.value) page.value = message.path
  if (message.type === "copy") void copy(message.text, "Code copied")
  if (message.type === "selection" && drop.value.canComment && !editing.value) {
    selection.value = message.clear ? null : {
      quote: message.quote, selector: message.selector, label: message.label,
      rect: { left: rect.left + message.rect.left, top: rect.top + message.rect.top, right: rect.left + message.rect.right, bottom: rect.top + message.rect.bottom },
    }
  }
  if (message.type === "image") {
    const from = message.rect && { left: rect.left + message.rect.left, top: rect.top + message.rect.top, width: message.rect.right - message.rect.left, height: message.rect.bottom - message.rect.top }
    areaMode.value = false
    lightbox.value = { src: message.src, alt: message.alt, selector: message.selector, label: message.label, from }
  }
  if (message.type === "area") {
    areaMode.value = false
    if (drop.value.canComment && !editing.value) {
      const { selector, label, ox, oy, ow, oh } = message
      popover.value = { type: "new", pending: { kind: "area", selector, label, ox, oy, ow, oh }, x: rect.left + message.rect.left, y: rect.top + message.rect.bottom }
    }
  }
  if (message.type === "unplaced") unplaced.value = new Set(message.ids)
  if (message.type === "marker") popover.value = { type: "thread", id: message.id, x: rect.left + message.clientX, y: rect.top + message.clientY }
  if (message.type === "key" && message.key === "Escape") {
    popover.value = selection.value = null
    areaMode.value = false
  }
  // Apps may use R themselves, so only docs forward it.
  if (message.type === "key" && message.key === "r" && !isApp.value) toggleArea()
})
watch(srcdoc, (value) => {
  if (contentOrigin.value && value === frameDocument) return
  ready.value = false
  if (contentOrigin.value) reloadFrame()
})
watch([ready, pageComments], () => {
  // `earlier`: the frame also checks that the element is still what the comment pointed at, not just in its place.
  // Comments on the whole page have nothing in it to pin to; they live in the panel.
  if (ready.value) send({ type: "markers", markers: pageComments.value.filter(comment => !replaced(comment) && comment.kind !== "page").map(({ id, n, kind, selector, ox, oy, ow, oh, quote, label, resolved, version, authorName, authorImage }) => ({ id, n, kind, selector, ox, oy, ow, oh, quote, label, resolved, earlier: version < drop.value.version, author: authorName, image: authorImage })) })
})

/** Area mode: the frame lays a crosshair over the page, and the next rectangle drawn there becomes a comment. */
const areaMode = ref(false)
// TODO(file-comments): files without a preview (PDFs, zips) have nothing to anchor a comment to, so they take none yet.
// Comments on the file as a whole would close that gap.
// A site takes its comments on the site itself (ViewerSite).
const canDrawArea = computed(() => drop.value.canComment && !editing.value && !lightbox.value && drop.value.kind !== "file" && drop.value.kind !== "folder" && drop.value.kind !== "site")
function toggleArea() {
  if (!canDrawArea.value) return
  popover.value = selection.value = null
  areaMode.value = !areaMode.value
  if (areaMode.value && !wide.value) mobileSide.value = false
}
watch(canDrawArea, value => !value && (areaMode.value = false))
watch([ready, areaMode], () => ready.value && send({ type: "area-mode", on: areaMode.value }))
// The frame keeps the drawn rectangle while its comment is written; drop it once the popover goes.
const draftingArea = computed(() => popover.value?.type === "new" && popover.value.pending.kind === "area")
watch(draftingArea, (now, before) => before && !now && send({ type: "clear-area" }))

defineShortcuts({
  c: () => !editing.value && panel.show("comments"),
  e: () => !editing.value && drop.value.canEdit && startEdit(),
  r: toggleArea,
  meta_s: { usingInput: true, handler: () => editing.value && void live.publish() },
  escape: () => {
    shownVersion.value = null
    popover.value = selection.value = null
    areaMode.value = false
  },
})

const copyFeedback = () => copy(feedbackMarkdown(drop.value.title, link.value, comments.value, drop.value.version), "Feedback copied as Markdown")
function copyLink() {
  if (drop.value.share !== "private") void copy(link.value, "Link copied")
  else shareOpen.value = true
}

const panelOpen = computed(() => (wide.value ? sideOpen.value : mobileSide.value))
// Each tab has its own button in the header, like a toolbar's panes: it opens the panel there, and closes it once open.
const has = (value: SideTab) => tabs.value.some(item => item.value === value)
const showing = (value: SideTab) => panelOpen.value && tab.value === value
const toggleTab = (value: SideTab) => (showing(value) ? panel.close() : panel.show(value))
// A folder someone else shares with you, with no description, has no tab to show (no comments, no Details), so no panel either.
const floating = computed(() => sideOpen.value && wide.value && !editing.value && tabs.value.length > 0)
/** The floating card is 22.5rem wide, 0.75rem from the edge, with 1rem of air before the page's text. */
const FLOATING_INSET = 16 * (22.5 + 0.75 + 1)
watch([ready, floating], () => ready.value && send({ type: "inset", right: floating.value ? FLOATING_INSET : 0 }))
watch(floating, value => (startInset = value ? FLOATING_INSET : 0), { immediate: true, flush: "sync" })

function commentOnSelection() {
  if (!selection.value) return
  const { selector, quote, label, rect } = selection.value
  popover.value = { type: "new", pending: { kind: "text", selector, ox: 0, oy: 0, ow: 0, oh: 0, quote, label }, x: rect.left, y: rect.bottom }
  selection.value = null
}

async function submit(body: string) {
  if (popover.value?.type !== "new") return
  const comment = await state.addComment({ ...popover.value.pending, ...(isApp.value ? { page: page.value } : {}) }, body)
  if (!comment) return popoverRef.value?.fail()
  popover.value = null
  send({ type: "clear-selection" })
}

/** A comment on the page as a whole, from the box at the bottom of the Comments panel. On an app, the page showing. */
async function addPageComment(body: string) {
  return Boolean(await state.addComment({ kind: "page", selector: "", ox: 0, oy: 0, ow: 0, oh: 0, ...(isApp.value ? { page: page.value } : {}) }, body))
}

async function resolve(id: string, resolved: boolean) {
  popover.value = null
  await state.resolveComment(id, resolved)
}

async function removeComment(id: string) {
  popover.value = null
  await state.removeComment(id)
}

async function reply(id: string, body: string) {
  if (await state.addReply(id, body)) await popoverRef.value?.sent()
  else popoverRef.value?.fail()
}

// A comment's link opens the drop with its thread showing (?comment=<n>, read below). It's the drop's own link, so
// it works for whoever can open the drop.
function copyCommentLink(comment: DropComment) {
  const url = new URL(link.value)
  url.searchParams.set("comment", String(comment.n))
  void copy(url.href, "Link to the comment copied")
}

/**
 * Scroll the document to the comment and open its thread there: the frame reports the pin, like a click on it. A comment
 * on the whole page has no pin: its thread opens beside its row in the panel (`row`), or at the top of the page.
 */
async function focusComment(comment: DropComment, row?: DOMRect) {
  if (isApp.value && comment.page && comment.page !== page.value) {
    page.value = comment.page
    // The new page reloads the frame; focus once it says it's ready rather than after a guessed delay.
    await nextTick()
    await until(ready).toBe(true, { timeout: 5000 })
  }
  if (!wide.value) mobileSide.value = false
  if (comment.kind !== "page") return send({ type: "focus", id: comment.id, open: true })
  // 352px wide (ViewerCommentPopover), so it sits just left of the panel.
  const top = frame.value?.getBoundingClientRect()
  popover.value = row && wide.value
    ? { type: "thread", id: comment.id, x: row.left - 360, y: row.top - 8 }
    : { type: "thread", id: comment.id, x: (top?.left ?? 0) + 16, y: (top?.top ?? 48) + 8 }
}

// `?comment=<n>` from a copied link: once the frame has placed the pins, open that thread with the comments showing.
onMounted(async () => {
  const n = Number(route.query.comment)
  if (!n || !["markdown", "image", "html", "app"].includes(drop.value.kind)) return
  await until(ready).toBe(true, { timeout: 10000 })
  const comment = comments.value.find(item => item.n === n)
  if (!comment) return notify.info({ title: `Comment #${n} isn't on this version`, icon: "i-ph-chat-circle-slash", color: "neutral" })
  if (wide.value && has("comments")) panel.show("comments")
  void focusComment(comment)
})

async function deleteDrop() {
  if (await remove(drop.value)) await navigateTo("/drops")
}

// The folders above, as breadcrumbs: in the app for people signed in, at their share links on a public page.
const moveTo = useMoveDialog()
const crumbTo = (crumb: { id: string; link: string; slug: string }) => (props.publicView ? dropPath(crumb) : `/drops/${crumb.id}`)

// Areas drawn over an image in the page anchor to that image, so the lightbox shows them too.
const imageComments = computed(() => (lightbox.value ? pageComments.value.filter(comment => comment.kind !== "text" && comment.selector === lightbox.value!.selector && !outdated.value.has(comment.id)) : []))
function pickImage(area: Area, x: number, y: number) {
  if (!lightbox.value) return
  popover.value = { type: "new", pending: { kind: "image", selector: lightbox.value.selector, ...area, label: lightbox.value.alt || "image" }, x, y }
}
const imageDraft = computed(() => (popover.value?.type === "new" && popover.value.pending.kind === "image" && popover.value.pending.ow ? popover.value.pending : undefined))
const threadComment = computed(() => (popover.value?.type === "thread" ? comments.value.find(comment => comment.id === (popover.value as { id: string }).id) : undefined))
</script>

<template>
  <DefineSide>
    <div class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-default pr-2 pl-2">
      <UTabs v-model="tab" class="min-w-0" color="neutral" :content="false" :items="tabs" size="sm">
        <template #trailing="{ item }">
          <span v-if="item.count" class="font-mono text-[11px] text-dimmed tabular-nums">{{ item.count }}</span>
        </template>
      </UTabs>
      <div class="flex items-center gap-1">
        <UButton v-if="tab === 'comments' && comments.length" aria-label="Copy feedback for your agent" color="neutral" icon="i-ph-sparkle" size="sm" title="Copy feedback for your agent" variant="ghost" @click="copyFeedback" />
        <UButton aria-label="Close panel" color="neutral" icon="i-ph-x" size="sm" variant="ghost" @click="panel.close" />
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ViewerComments
        v-if="tab === 'comments'"
        :can-comment="drop.canComment"
        :can-manage="drop.isOwner"
        :comments="comments"
        :add-page-comment="addPageComment"
        :outdated="outdated"
        :version="drop.version"
        :versions="drop.versions"
        @focus="focusComment"
        @resolve="resolve"
      />
      <ViewerHistory v-else-if="tab === 'history'" :comments="comments" :drop="drop" :selected="shownVersion?.id" @open="showVersion" />

      <ViewerOverview v-else :drop="drop" @share="shareOpen = true">
        <template #actions>
          <ViewerAction icon="i-ph-link" label="Copy link" @click="copyLink" />
          <ViewerAction v-if="drop.url" icon="i-ph-download-simple" label="Download original" @click="navigateTo(drop.url, { external: true, open: { target: '_blank' } })" />
          <ViewerAction v-if="owner && !trashed" icon="i-ph-folder-simple-plus" label="Move to folder" @click="moveTo({ drop })" />
          <ViewerAction v-if="drop.canTrash && !trashed" destructive icon="i-ph-trash" label="Move to Trash" @click="deleteDrop" />
        </template>
      </ViewerOverview>
    </div>
  </DefineSide>

  <UDashboardPanel id="drop-main" :ui="{ body: 'p-0 sm:p-0 gap-0 overflow-hidden' }">
    <template #header>
      <UDashboardNavbar :toggle="!visitor" :ui="{ root: 'h-12 gap-2 px-2 sm:px-3', left: 'min-w-0', title: 'min-w-0' }">
        <template #leading>
          <SidebarExpand v-if="!visitor" />
          <NuxtLink v-if="visitor" aria-label="Drop" class="grid size-8 place-items-center" to="/"><DropMark class="h-4 w-6" /></NuxtLink>
          <UButton v-else-if="drop.ancestors.length" :aria-label="`Back to ${drop.ancestors.at(-1)!.title}`" color="neutral" icon="i-ph-arrow-left" size="sm" variant="ghost" :to="crumbTo(drop.ancestors.at(-1)!)" />
          <UButton v-else aria-label="Back to drops" color="neutral" icon="i-ph-arrow-left" size="sm" variant="ghost" to="/drops" />
        </template>
        <template #title>
          <span class="flex min-w-0 items-center gap-2">
            <nav v-if="drop.ancestors.length" aria-label="Folders" class="hidden min-w-0 shrink items-center gap-1 text-sm text-muted sm:flex">
              <template v-for="crumb in drop.ancestors" :key="crumb.id">
                <NuxtLink class="max-w-40 truncate transition-colors hover:text-highlighted" :to="crumbTo(crumb)">{{ crumb.title }}</NuxtLink>
                <UIcon name="i-ph-caret-right" class="size-3 shrink-0 text-dimmed" />
              </template>
            </nav>
            <span class="truncate text-sm font-medium">{{ drop.title }}</span>
            <ConnectionStatus v-if="editing" class="label-mono shrink-0 data-[status=reconnecting]:text-error" :status="live.status.value">
              <ConnectionStatusLabel v-slot="{ state }">{{ liveLabel(state) }}</ConnectionStatusLabel>
            </ConnectionStatus>
          </span>
        </template>
        <template v-if="editing" #right>
          <AvatarStack v-if="live.people.value.length" class="mr-1" :max="5" :people="live.people.value" :style="{ '--vh-avatar-size': '1.25rem' }" variant="outline" />
          <UButton color="neutral" label="Close" size="sm" variant="ghost" @click="live.close" />
          <UButton color="neutral" :disabled="!live.synced.value" label="Publish" :loading="live.publishing.value" size="sm" @click="live.publish()" />
        </template>
        <!-- One row of same-size tools: icons only, the pressed state shows the mode, shortcuts live in the tooltips. -->
        <template v-else #right>
          <UTooltip v-if="canDrawArea" :kbds="['R']" text="Comment on an area">
            <UButton aria-label="Comment on an area" :aria-pressed="areaMode" color="neutral" icon="i-ph-chat-teardrop" size="sm" :variant="areaMode ? 'soft' : 'ghost'" @click="toggleArea" />
          </UTooltip>
          <UTooltip v-if="drop.canEdit || drop.editNote" :kbds="drop.canEdit ? ['E'] : undefined" :text="drop.editNote ?? 'Edit together'">
            <UButton aria-label="Edit together" color="neutral" :disabled="!drop.canEdit" icon="i-ph-pencil-simple" :loading="live.opening.value" size="sm" variant="ghost" @click="startEdit" />
          </UTooltip>
          <UTooltip v-if="has('comments')" :kbds="['C']" text="Comments">
            <UButton :aria-label="openCount ? `Comments, ${openCount} open` : 'Comments'" :aria-pressed="showing('comments')" color="neutral" icon="i-ph-chats" :label="openCount ? String(openCount) : undefined" size="sm" :ui="{ label: 'font-mono text-xs tabular-nums' }" :variant="showing('comments') ? 'soft' : 'ghost'" @click="toggleTab('comments')" />
          </UTooltip>
          <UTooltip v-if="has('history')" text="History">
            <UButton aria-label="History" :aria-pressed="showing('history')" color="neutral" icon="i-ph-clock-counter-clockwise" size="sm" :variant="showing('history') ? 'soft' : 'ghost'" @click="toggleTab('history')" />
          </UTooltip>
          <UTooltip v-if="has('details')" text="Details">
            <UButton aria-label="Details" :aria-pressed="showing('details')" color="neutral" icon="i-ph-info" size="sm" :variant="showing('details') ? 'soft' : 'ghost'" @click="toggleTab('details')" />
          </UTooltip>
          <!-- No right margin: the ghost buttons after it pad themselves, and more air cut the share button off the tools. -->
          <USeparator v-if="canDrawArea || drop.canEdit || drop.editNote || tabs.length" class="ml-1 h-4" orientation="vertical" />
          <UTooltip v-if="!owner" text="Copy link">
            <UButton aria-label="Copy link" color="neutral" icon="i-ph-link" size="sm" variant="ghost" @click="copy(link, 'Link copied')" />
          </UTooltip>
          <!-- Strangers report through the abuse queue; teammates can talk to the owner, so they don't get a flag. -->
          <UTooltip v-if="visitor" text="Report">
            <UButton aria-label="Report" :to="{ path: '/report', query: { target: `/d/${drop.link}` } }" color="neutral" icon="i-ph-flag" size="sm" variant="ghost" />
          </UTooltip>
          <UButton v-if="owner" color="neutral" :icon="SHARE_ICONS[drop.share]" :label="drop.share === 'private' && !drop.shareReview ? 'Share' : shareStatus(drop)" size="sm" :variant="drop.share === 'private' ? 'solid' : 'ghost'" @click="shareOpen = true" />
          <UButton v-else-if="visitor" class="hidden sm:inline-flex" color="neutral" label="Make Your Own" size="sm" to="/" variant="outline" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="owner && trashed"
        :actions="[{ label: 'Restore', color: 'error', variant: 'outline', size: 'sm', loading: restoring, onClick: restoreDrop }]"
        class="rounded-none border-0 border-b border-default"
        color="error"
        :description="drop.trashReason === 'expired' ? 'Nobody opened it for a while, so its link stopped working. Only you and admins can see it until you restore it.' : 'Its link stopped working. Only you and admins can see it until you restore it.'"
        icon="i-ph-trash"
        orientation="horizontal"
        :title="expiryLabel(drop, now)"
        variant="subtle"
      />
      <UAlert
        v-else-if="older"
        :actions="[{ label: `Open v${latest.version}`, color: 'neutral', variant: 'outline', size: 'sm', to: latestTo }]"
        class="rounded-none border-0 border-b border-default"
        color="neutral"
        :description="`v${latest.version} is the latest version.`"
        icon="i-ph-clock-counter-clockwise"
        orientation="horizontal"
        :title="`You're reading v${drop.version}`"
        variant="subtle"
      />
      <UAlert
        v-else-if="sentVersion && sentNotice"
        :actions="[{ label: `View v${sentVersion}`, color: 'neutral', variant: 'outline', size: 'sm', to: dropPath(drop, sentVersion) }]"
        class="rounded-none border-0 border-b border-default"
        close
        color="neutral"
        :description="`The link you opened pointed at v${sentVersion}. This is v${drop.version}, the latest.`"
        icon="i-ph-arrow-up-right"
        orientation="horizontal"
        title="Updated since this link was shared"
        variant="subtle"
        @update:open="sentNotice = $event"
      />
      <div v-if="isApp" class="flex h-9 shrink-0 items-center gap-2 border-b border-default px-3">
        <span class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-elevated px-2.5 py-1 font-mono text-xs text-muted">
          <UIcon :name="SHARE_ICONS[drop.share]" class="size-3 shrink-0" />
          <span class="truncate">{{ drop.slug || drop.link }}/{{ page === "index.html" ? "" : page }}</span>
        </span>
        <USelect v-if="pages.length > 1" v-model="page" class="w-40 font-mono" :items="pages" size="xs" />
      </div>

      <div class="relative flex min-h-0 flex-1 flex-col">
        <LazyViewerEditor v-if="editing" :editor="live.editor.value" :synced="live.synced.value" />
        <!-- The grid keeps clear of the floating panel, like a doc's text (FLOATING_INSET). -->
        <ViewerFolder v-else-if="drop.kind === 'folder'" :class="floating && 'pr-96'" :drop="drop" :public-view="publicView" />
        <ViewerSite v-else-if="drop.kind === 'site'" :drop="drop" :inset="floating ? FLOATING_INSET : 0" :public-view="publicView" />
        <div v-else-if="drop.kind === 'file'" class="grid flex-1 place-items-center p-10 text-center">
          <div>
            <UIcon name="i-ph-file" class="size-8 text-dimmed" />
            <p class="mt-3 font-mono text-sm">{{ drop.filename }}</p>
            <p class="mt-1 text-sm text-muted">No preview for this file type.</p>
            <UButton v-if="drop.url" class="mt-4" color="neutral" icon="i-ph-download-simple" label="Download" :to="drop.url" external target="_blank" variant="outline" />
          </div>
        </div>
        <iframe v-else-if="contentOrigin" :key="frameKey" ref="frame" class="block min-h-0 w-full flex-1 bg-default [color-scheme:light]" :sandbox="CONTENT_SANDBOX" :src="frameSrc" :title="drop.title" />
        <!-- Server and client bundlers format the embedded app resolver differently. [color-scheme:light] on both frames
             matches a blank or light document, so the browser paints no opaque white backdrop behind it in dark mode. -->
        <iframe v-else-if="srcdoc" ref="frame" class="block min-h-0 w-full flex-1 bg-default [color-scheme:light]" data-allow-mismatch="attribute" :sandbox="PREVIEW_SANDBOX" :srcdoc="srcdoc" :title="drop.title" />

        <ViewerDiff v-if="shownVersion && !editing" :key="shownVersion.id" :inset="floating ? FLOATING_INSET : 0" :previous="previousVersion" :version="shownVersion" @close="shownVersion = null" />

        <!-- As tall as its content, so a quiet drop gets a small card. Markdown docs make room for it (FLOATING_INSET). -->
        <aside
          v-if="floating"
          class="absolute top-3 right-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[22.5rem] origin-top-right flex-col overflow-hidden rounded-lg border border-default bg-default shadow-md [animation:pop-in_160ms_var(--ease-out)]"
        >
          <ReuseSide />
        </aside>
      </div>
    </template>
  </UDashboardPanel>
  <USlideover v-if="!wide && !editing" v-model:open="mobileSide" side="right" :ui="{ content: 'max-w-md' }" title="Drop panel">
    <template #content>
      <div class="flex h-full flex-col"><ReuseSide /></div>
    </template>
  </USlideover>

  <div
    v-if="selection && !popover"
    class="fixed z-30 -translate-x-1/2 -translate-y-full"
    :style="{ left: `${Math.min(Math.max(60, (selection.rect.left + selection.rect.right) / 2), windowWidth - 60)}px`, top: `${Math.max(56, selection.rect.top - 8)}px` }"
  >
    <div class="flex origin-bottom items-center rounded-md border border-default bg-default p-0.5 shadow-sm [animation:pop-in_140ms_var(--ease-out)]">
      <UButton color="neutral" icon="i-ph-chat-circle" label="Comment" size="sm" variant="ghost" @click="commentOnSelection" @mousedown.prevent />
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
    @close="lightbox = null; popover = null"
    @pick="pickImage"
    @thread="(id, x, y) => (popover = { type: 'thread', id, x, y })"
  />

  <ViewerCommentPopover
    v-if="popover"
    ref="popoverRef"
    :can-manage="drop.isOwner"
    :comment="threadComment"
    :pending="popover.type === 'new' ? popover.pending : undefined"
    :x="popover.x"
    :y="popover.y"
    :can-reply="drop.canComment"
    @cancel="popover = null"
    @copy-link="copyCommentLink"
    @delete="removeComment"
    @delete-reply="(id, replyId) => state.removeReply(id, replyId)"
    @reply="reply"
    @resolve="resolve"
    @submit="submit"
  />

  <ViewerShareModal v-if="owner" v-model:open="shareOpen" :drop="drop" />
</template>
