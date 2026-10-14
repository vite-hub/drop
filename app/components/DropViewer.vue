<script setup lang="ts">
// The drop viewer (T3 Code's layout): a main column with its own header, and one full-height side panel with
// tabs (Comments, Details) that pushes the content. Docs and apps share it. People review and comment; agents
// publish new versions. State lives in composables (useDrop, useViewerPanel, useAppFiles, useDropFrame); this
// file wires them up.
import { planDocument } from "#shared/documents"
import { expiryLabel } from "#shared/expiry"
import { injectRuntime } from "#shared/plan-runtime"
import type { PlanKind } from "#shared/plans"
import { buildProjectDocument, pageAt, pageUrl } from "#shared/project-bundle"
import type { DropComment } from "#shared/types"
import type { PendingComment } from "./viewer/ViewerCommentPopover.vue"

type Selection = { quote: string; selector: string; label: string; rect: { left: number; top: number; right: number; bottom: number } }
type Lightbox = { src: string; alt: string; selector: string; label: string }
type Popover = { x: number; y: number } & ({ type: "new"; pending: PendingComment } | { type: "thread"; id: string })

const props = withDefaults(defineProps<{ publicView?: boolean }>(), { publicView: false })

const state = injectDrop()!
const drop = computed(() => state.drop.data.value!)
const comments = computed(() => state.comments.data.value)

const notify = useNotify()
const { copy } = useCopy()
const { remove, setExpiry } = useDropActions()
const colorMode = useColorMode()
const mounted = useMounted()
const dark = computed(() => mounted.value && colorMode.value === "dark")
const [DefineSide, ReuseSide] = createReusableTemplate()
const { width: windowWidth } = useWindowSize()

const isApp = computed(() => drop.value.kind === "app")
const owner = computed(() => drop.value.isOwner && !props.publicView)
const openCount = computed(() => comments.value.filter(comment => !comment.resolved).length)
const link = computed(() => (import.meta.client ? `${location.origin}/d/${drop.value.id}` : `/d/${drop.value.id}`))
const now = useRelativeNow()
const expired = computed(() => drop.value.expiresAt !== null && drop.value.expiresAt <= now.value)
const renewing = ref(false)
async function renew() {
  renewing.value = true
  if (await setExpiry(drop.value, { renew: true })) notify.done("Drop restored")
  renewing.value = false
}

const panel = useViewerPanel({ owner, openCount })
const { wide, sideOpen, mobileSide, tabs, tab } = panel
const { files, pages, page } = useAppFiles(drop)

// Images load into the sandbox as data URLs: the opaque-origin frame can't send your session cookie.
const imageBlob = shallowRef<Blob>()
const { base64: imageData } = useBase64(imageBlob)
onMounted(async () => {
  if (drop.value.kind !== "image" || !drop.value.url) return
  imageBlob.value = await $fetch<Blob>(drop.value.url, { responseType: "blob" }).catch(() => undefined)
})

const appDocument = (path: string) => injectRuntime(buildProjectDocument(files.value, path), dark.value)
const srcdoc = computed(() => {
  if (isApp.value) return appDocument(page.value)
  if (drop.value.kind === "image") return imageData.value ? planDocument("image", imageData.value, dark.value) : ""
  return planDocument(drop.value.kind as PlanKind, drop.value.content ?? "", dark.value, drop.value.html)
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
const popoverRef = useTemplateRef<{ fail: () => void }>("popoverRef")
const shareOpen = ref(false)

const pageComments = computed(() => (isApp.value ? comments.value.filter(comment => comment.page === page.value || (!comment.page && page.value === pages.value[0])) : comments.value))

const { ready, send } = useDropFrame(frame, contentOrigin, (message, rect) => {
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
  if (message.type === "selection" && drop.value.canComment) {
    selection.value = message.clear ? null : {
      quote: message.quote, selector: message.selector, label: message.label,
      rect: { left: rect.left + message.rect.left, top: rect.top + message.rect.top, right: rect.left + message.rect.right, bottom: rect.top + message.rect.bottom },
    }
  }
  if (message.type === "image") lightbox.value = { src: message.src, alt: message.alt, selector: message.selector, label: message.label }
  if (message.type === "marker") popover.value = { type: "thread", id: message.id, x: rect.left + message.clientX, y: rect.top + message.clientY }
  if (message.type === "key" && message.key === "Escape") popover.value = selection.value = null
})
watch(srcdoc, (value) => {
  if (contentOrigin.value && value === frameDocument) return
  ready.value = false
  if (contentOrigin.value) reloadFrame()
})
watch([ready, pageComments], () => {
  if (ready.value) send({ type: "markers", markers: pageComments.value.map(({ id, n, kind, selector, ox, oy, quote, resolved }) => ({ id, n, kind, selector, ox, oy, quote, resolved })) })
})

defineShortcuts({ c: () => panel.show("comments") })
onKeyStroke("Escape", () => (popover.value = selection.value = null))

const copyFeedback = () => copy(feedbackMarkdown(drop.value.title, link.value, comments.value), "Feedback copied as Markdown")
function copyLink() {
  if (drop.value.visibility === "shared") void copy(link.value, "Link copied")
  else shareOpen.value = true
}

const togglePanel = panel.toggle
const panelOpen = computed(() => (wide.value ? sideOpen.value : mobileSide.value))

function commentOnSelection() {
  if (!selection.value) return
  const { selector, quote, label, rect } = selection.value
  popover.value = { type: "new", pending: { kind: "text", selector, ox: 0, oy: 0, quote, label }, x: rect.left, y: rect.bottom }
  selection.value = null
}

async function submit(body: string) {
  if (popover.value?.type !== "new") return
  const comment = await state.addComment({ ...popover.value.pending, ...(isApp.value ? { page: page.value } : {}) }, body)
  if (!comment) return popoverRef.value?.fail()
  popover.value = null
  send({ type: "clear-selection" })
}

async function resolve(id: string, resolved: boolean) {
  popover.value = null
  await state.resolveComment(id, resolved)
}

async function removeComment(id: string) {
  popover.value = null
  await state.removeComment(id)
}

function focusComment(comment: DropComment) {
  if (!isApp.value) return send({ type: "focus", id: comment.id })
  const move = comment.page && comment.page !== page.value
  if (move) page.value = comment.page!
  useTimeoutFn(() => send({ type: "focus", id: comment.id }), move ? 600 : 0)
  if (!wide.value) mobileSide.value = false
}

async function deleteDrop() {
  if (await remove(drop.value)) await navigateTo("/drops")
}

const imageComments = computed(() => (lightbox.value ? pageComments.value.filter(comment => comment.kind === "image" && comment.selector === lightbox.value!.selector) : []))
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
        <UButton v-if="tab === 'comments' && comments.length" aria-label="Copy feedback for your agent" color="neutral" icon="i-lucide-sparkles" size="sm" title="Copy feedback for your agent" variant="ghost" @click="copyFeedback" />
        <UButton aria-label="Close panel" color="neutral" icon="i-lucide-x" size="sm" variant="ghost" @click="panel.close" />
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ViewerComments v-if="tab === 'comments'" :can-comment="drop.canComment" :can-manage="drop.isOwner" :comments="comments" @focus="focusComment" @resolve="resolve" />

      <ViewerOverview v-else :drop="drop" @share="shareOpen = true">
        <template #actions>
          <ViewerAction icon="i-lucide-sparkles" label="Copy feedback for your agent" @click="copyFeedback" />
          <ViewerAction icon="i-lucide-link" label="Copy link" @click="copyLink" />
          <ViewerAction v-if="drop.url" icon="i-lucide-download" label="Download original" @click="navigateTo(drop.url, { external: true, open: { target: '_blank' } })" />
          <ViewerAction destructive icon="i-lucide-trash" label="Delete drop" @click="deleteDrop" />
        </template>
      </ViewerOverview>
    </div>
  </DefineSide>

  <UDashboardPanel id="drop-main" :ui="{ body: 'p-0 sm:p-0 gap-0 overflow-hidden' }">
    <template #header>
      <UDashboardNavbar :toggle="!publicView" :ui="{ root: 'h-12 gap-2 px-2 sm:px-3', left: 'min-w-0', title: 'min-w-0' }">
        <template #leading>
          <NuxtLink v-if="publicView" aria-label="Drop" class="grid size-8 place-items-center" to="/"><DropMark class="h-4 w-6" /></NuxtLink>
          <UButton v-else aria-label="Back to drops" color="neutral" icon="i-lucide-arrow-left" variant="ghost" to="/drops" />
        </template>
        <template #title>
          <span class="truncate text-sm font-medium">{{ drop.title }}</span>
        </template>
        <template #right>
          <UButton v-if="publicView" :to="{ path: '/report', query: { target: `/d/${drop.id}` } }" color="neutral" label="Report" size="sm" variant="ghost" />
          <UButton v-if="owner" color="neutral" :icon="drop.visibility === 'shared' ? 'i-lucide-globe' : 'i-lucide-lock'" :label="drop.shareReview === 'pending' ? 'Pending review' : drop.shareReview === 'rejected' ? 'Share rejected' : drop.visibility === 'shared' ? 'Shared' : 'Share'" size="sm" :variant="drop.visibility === 'shared' ? 'outline' : 'solid'" @click="shareOpen = true" />
          <UButton v-else-if="publicView" class="hidden sm:inline-flex" color="neutral" label="Make Your Own" size="sm" to="/" variant="outline" />
          <span class="relative">
            <UButton :aria-label="panelOpen ? 'Hide panel' : 'Show panel'" :aria-pressed="panelOpen" color="neutral" icon="i-lucide-panel-right" :variant="panelOpen ? 'soft' : 'ghost'" @click="togglePanel" />
            <span v-if="openCount && !panelOpen" class="pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full bg-inverted ring-2 ring-(--ui-bg)" />
          </span>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="owner && expired"
        :actions="[{ label: 'Renew', color: 'error', variant: 'outline', size: 'sm', loading: renewing, onClick: renew }]"
        class="rounded-none border-0 border-b border-default"
        color="error"
        description="Nobody opened it for a while, so its link stopped working. Only you and editors can see it until you renew it."
        icon="i-lucide-clock"
        orientation="horizontal"
        :title="expiryLabel(drop, now)"
        variant="subtle"
      />
      <div v-if="isApp" class="flex h-9 shrink-0 items-center gap-2 border-b border-default px-3">
        <span class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-elevated px-2.5 py-1 font-mono text-xs text-muted">
          <UIcon :name="drop.visibility === 'shared' ? 'i-lucide-globe' : 'i-lucide-lock'" class="size-3 shrink-0" />
          <span class="truncate">/d/{{ drop.id.slice(0, 8) }}/{{ page === "index.html" ? "" : page }}</span>
        </span>
        <USelect v-if="pages.length > 1" v-model="page" class="w-40 font-mono" :items="pages" size="xs" />
      </div>

      <div v-if="drop.kind === 'file'" class="grid flex-1 place-items-center p-10 text-center">
        <div>
          <UIcon name="i-lucide-file" class="size-8 text-dimmed" />
          <p class="mt-3 font-mono text-sm">{{ drop.filename }}</p>
          <p class="mt-1 text-sm text-muted">No preview for this file type.</p>
          <UButton v-if="drop.url" class="mt-4" color="neutral" icon="i-lucide-download" label="Download" :to="drop.url" external target="_blank" variant="outline" />
        </div>
      </div>
      <iframe v-else-if="contentOrigin" :key="frameKey" ref="frame" class="block min-h-0 w-full flex-1 bg-default" :sandbox="CONTENT_SANDBOX" :src="frameSrc" :title="drop.title" />
      <!-- Server and client bundlers format the embedded app resolver differently. -->
      <iframe v-else-if="srcdoc" ref="frame" class="block min-h-0 w-full flex-1 bg-default" data-allow-mismatch="attribute" :sandbox="PREVIEW_SANDBOX" :srcdoc="srcdoc" :title="drop.title" />
    </template>
  </UDashboardPanel>

  <UDashboardPanel v-if="sideOpen && wide" id="drop-side" :default-size="24" :max-size="40" :min-size="18" resizable :ui="{ root: 'border-l border-default', body: 'p-0 sm:p-0 gap-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full flex-col"><ReuseSide /></div>
    </template>
  </UDashboardPanel>
  <USlideover v-if="!wide" v-model:open="mobileSide" side="right" :ui="{ content: 'max-w-md' }" title="Drop panel">
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
      <UButton color="neutral" icon="i-lucide-message-circle" label="Comment" size="sm" variant="ghost" @click="commentOnSelection" @mousedown.prevent />
    </div>
  </div>

  <ViewerLightbox
    v-if="lightbox"
    :alt="lightbox.alt"
    :can-comment="drop.canComment"
    :comments="imageComments"
    :src="lightbox.src"
    @close="lightbox = null; popover = null"
    @pick="(ox, oy, x, y) => (popover = { type: 'new', pending: { kind: 'image', selector: lightbox!.selector, ox, oy, label: lightbox!.alt || 'image' }, x, y })"
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
    @cancel="popover = null"
    @delete="removeComment"
    @resolve="resolve"
    @submit="submit"
  />

  <ViewerShareModal v-if="owner" v-model:open="shareOpen" :drop="drop" />
</template>
