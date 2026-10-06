<script setup lang="ts">
// The drop viewer (T3 Code's layout): a main column with its own header, and one full-height side panel with
// tabs (Comments, Source or Files, Details) that pushes the content. Docs and apps share it.
import { breakpointsTailwind } from "@vueuse/core"
import { editorDocument, planDocument } from "#shared/markdown"
import { injectRuntime } from "#shared/plan-runtime"
import type { PlanKind } from "#shared/plans"
import { buildProjectDocument } from "#shared/project-bundle"
import type { DropComment, DropDetail, DropSummary } from "#shared/types"
import type { PendingComment } from "./viewer/ViewerCommentPopover.vue"

type Selection = { quote: string; selector: string; label: string; rect: { left: number; top: number; right: number; bottom: number } }
type Lightbox = { src: string; alt: string; selector: string; label: string }
type Popover = { x: number; y: number } & ({ type: "new"; pending: PendingComment } | { type: "thread"; id: string })

const props = withDefaults(defineProps<{ drop: DropDetail; comments: DropComment[]; publicView?: boolean }>(), { publicView: false })
const emit = defineEmits<{ refresh: []; refreshComments: [] }>()

const route = useRoute()
const toast = useToast()
const confirm = useConfirm()
const prompt = usePrompt()
const { copy } = useCopy()
const colorMode = useColorMode()
const dark = computed(() => colorMode.value === "dark")
// The server assumes a laptop width, so SSR renders the panel where the browser will put it.
const wide = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 }).greaterOrEqual("lg")
const [DefineSide, ReuseSide] = createReusableTemplate()
const { width: windowWidth } = useWindowSize()

const isApp = computed(() => props.drop.kind === "app")
const owner = computed(() => props.drop.isOwner && !props.publicView)
const openCount = computed(() => props.comments.filter(comment => !comment.resolved).length)
const link = computed(() => (import.meta.client ? `${location.origin}/d/${props.drop.id}` : `/d/${props.drop.id}`))

// Side panel: open on wide screens unless you closed it; the last tab sticks across drops (cookies, see useSidePanel).
const { open: sideOpenStored, tab: storedTab } = useSidePanel()
const sideOpen = computed({ get: () => sideOpenStored.value && wide.value, set: value => (sideOpenStored.value = value) })
const mobileSide = ref(false)
const tabs = computed(() => [
  { value: "comments" as const, label: "Comments", count: openCount.value },
  { value: "source" as const, label: isApp.value ? "Files" : "Source", count: isApp.value ? props.drop.paths?.length : undefined },
  ...(owner.value ? [{ value: "details" as const, label: "Details" }] : []),
])
const tab = computed<SideTab>({
  get: () => (tabs.value.some(item => item.value === storedTab.value) ? storedTab.value : "comments"),
  set: value => (storedTab.value = value),
})
function togglePanel() {
  if (wide.value) sideOpen.value = !sideOpen.value
  else mobileSide.value = !mobileSide.value
}
function showTab(value: SideTab) {
  tab.value = value
  if (wide.value) sideOpen.value = true
  else mobileSide.value = true
}

// Docs: preview, or the rich editor (Markdown) / source editor (HTML) while editing.
const docEdit = ref<{ text: string; mode: "rich" | "source"; saving: boolean } | null>(null)
const editorSource = ref(props.drop.content ?? "")
const docDirty = computed(() => (docEdit.value ? docEdit.value.text !== (props.drop.content ?? "") : false))

// Apps: preview a page or read a file; edits are drafts until published.
const drafts = ref<Record<string, string> | null>(null)
const appSaving = ref(false)
const files = computed(() => drafts.value ?? props.drop.files ?? {})
const pages = computed(() => Object.keys(files.value).filter(path => path.endsWith(".html")).sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b))))
const page = ref("index.html")
const view = ref<"preview" | "code">("preview")
const file = ref("index.html")
const appDirty = computed(() => (drafts.value ? Object.keys({ ...drafts.value, ...props.drop.files }).some(path => drafts.value![path] !== props.drop.files?.[path]) : false))

const editing = computed(() => Boolean(docEdit.value || drafts.value))
const dirty = computed(() => docDirty.value || appDirty.value)
const saving = computed(() => Boolean(docEdit.value?.saving || appSaving.value))

// Images load into the sandbox as data URLs: the opaque-origin frame can't send your session cookie.
const imageBlob = shallowRef<Blob>()
const { base64: imageData } = useBase64(imageBlob)
onMounted(async () => {
  if (props.drop.kind !== "image" || !props.drop.url) return
  imageBlob.value = await $fetch<Blob>(props.drop.url, { responseType: "blob" }).catch(() => undefined)
})

// Live app preview while editing, debounced so typing doesn't reload the app on every key.
const previewFiles = refDebounced(files, () => (drafts.value ? 450 : 0))

const srcdoc = computed(() => {
  if (isApp.value) return injectRuntime(buildProjectDocument(previewFiles.value, page.value), dark.value)
  if (docEdit.value?.mode === "rich") return editorDocument(editorSource.value, dark.value)
  if (props.drop.kind === "image") return imageData.value ? planDocument("image", imageData.value, dark.value) : ""
  return planDocument(props.drop.kind as PlanKind, props.drop.content ?? "", dark.value)
})

const frame = useTemplateRef<HTMLIFrameElement>("frame")
const ready = ref(false)
const selection = ref<Selection | null>(null)
const lightbox = ref<Lightbox | null>(null)
const popover = ref<Popover | null>(null)
const popoverRef = useTemplateRef<{ fail: () => void }>("popoverRef")
const shareOpen = ref(false)

const pageComments = computed(() => (isApp.value ? props.comments.filter(comment => comment.page === page.value || (!comment.page && page.value === pages.value[0])) : props.comments))
const send = (message: Record<string, unknown>) => frame.value?.contentWindow?.postMessage({ __drop: true, ...message }, "*")
const markers = () => pageComments.value.map(({ id, n, kind, selector, ox, oy, quote, resolved }) => ({ id, n, kind, selector, ox, oy, quote, resolved }))

watch(srcdoc, () => (ready.value = false))
watch([ready, pageComments], () => {
  if (ready.value && !docEdit.value) send({ type: "markers", markers: markers() })
})

function onMessage(event: MessageEvent) {
  const message = event.data
  if (!message?.__drop || !frame.value || event.source !== frame.value.contentWindow) return
  const rect = frame.value.getBoundingClientRect()
  if (message.type === "ready") ready.value = true
  if (message.type === "navigate" && isApp.value) page.value = message.path
  if (message.type === "copy") void copy(message.text, "Code copied")
  if (message.type === "edit-change" && docEdit.value) docEdit.value.text = message.markdown
  if (message.type === "edit-save") void save()
  if (message.type === "edit-error" && docEdit.value) {
    toast.add({ title: "The editor couldn't load", description: "Editing the Markdown source instead." })
    docEdit.value.mode = "source"
  }
  if (message.type === "selection" && props.drop.canComment && !editing.value) {
    selection.value = message.clear ? null : {
      quote: message.quote, selector: message.selector, label: message.label,
      rect: { left: rect.left + message.rect.left, top: rect.top + message.rect.top, right: rect.left + message.rect.right, bottom: rect.top + message.rect.bottom },
    }
  }
  if (message.type === "image" && !editing.value) lightbox.value = { src: message.src, alt: message.alt, selector: message.selector, label: message.label }
  if (message.type === "marker") popover.value = { type: "thread", id: message.id, x: rect.left + message.clientX, y: rect.top + message.clientY }
  if (message.type === "key" && message.key === "Escape") {
    popover.value = null
    selection.value = null
  }
}
useEventListener(import.meta.client ? window : undefined, "message", onMessage)
defineShortcuts({
  meta_s: { usingInput: true, handler: () => editing.value && void save() },
  escape: { usingInput: true, handler: () => (popover.value = selection.value = null) },
  c: () => !editing.value && showTab("comments"),
})
onMounted(() => {
  if (route.query.edit === "1" && props.drop.canEdit) startEdit()
  openFileFromQuery()
})

// The sidebar tree links straight to a file: HTML opens as a page, anything else in the code view.
function openFileFromQuery() {
  const target = typeof route.query.file === "string" ? route.query.file : null
  if (!isApp.value || !target || !(target in files.value)) return
  openFile(target)
}
watch(() => route.query.file, openFileFromQuery)

function openFile(path: string) {
  file.value = path
  if (path.endsWith(".html")) {
    page.value = path
    view.value = "preview"
  }
  else {
    view.value = "code"
  }
}

const copyFeedback = () => copy(feedbackMarkdown(props.drop.title, link.value, props.comments), "Feedback copied as Markdown")
function copyLink() {
  if (props.drop.visibility === "shared") void copy(link.value, "Link copied")
  else shareOpen.value = true
}

function startEdit() {
  popover.value = null
  selection.value = null
  if (isApp.value) {
    drafts.value = { ...(props.drop.files ?? {}) }
    showTab("source")
    return
  }
  editorSource.value = props.drop.content ?? ""
  docEdit.value = { text: props.drop.content ?? "", mode: props.drop.kind === "markdown" ? "rich" : "source", saving: false }
}

async function cancelEdit() {
  if (dirty.value && !await confirm({ title: "Discard your changes?", description: "Nothing was published.", confirmLabel: "Discard", destructive: true })) return
  docEdit.value = null
  drafts.value = null
}

async function save() {
  if (!editing.value || saving.value) return
  if (!dirty.value) return cancelEdit()
  try {
    if (drafts.value) {
      appSaving.value = true
      const next = await $fetch<DropSummary>(`/api/drops/${props.drop.id}/versions`, { method: "POST", body: { files: drafts.value } })
      toast.add({ title: `Published v${next.version}`, description: props.drop.visibility === "shared" ? "Everyone with the link sees it now." : "Only you can see it." })
      drafts.value = null
      view.value = "preview"
      emit("refresh")
    }
    else if (docEdit.value) {
      docEdit.value.saving = true
      const next = await $fetch<DropSummary>(`/api/drops/${props.drop.id}/versions`, { method: "POST", body: { content: docEdit.value.text } })
      toast.add({ title: "Published a new version", description: "The previous version stays in history." })
      docEdit.value = null
      if (!props.publicView) await refreshDrops()
      await navigateTo(props.publicView ? `/d/${next.id}` : `/drops/${next.id}`)
    }
  }
  catch (error) {
    if (docEdit.value) docEdit.value.saving = false
    toast.add({ title: "Couldn't publish", description: errorText(error) })
  }
  appSaving.value = false
}

async function addFile() {
  const path = (await prompt({ title: "New file", label: "Path", placeholder: "components/button.js", confirmLabel: "Add File" }))?.replace(/^\/+/, "")
  if (!path || !drafts.value) return
  if (!(path in drafts.value)) drafts.value = { ...drafts.value, [path]: "" }
  openFile(path)
}

function commentOnSelection() {
  if (!selection.value) return
  const { selector, quote, label, rect } = selection.value
  popover.value = { type: "new", pending: { kind: "text", selector, ox: 0, oy: 0, quote, label }, x: rect.left, y: rect.bottom }
  selection.value = null
}

async function submit(body: string) {
  if (popover.value?.type !== "new") return
  try {
    const comment = await $fetch<DropComment>(`/api/drops/${props.drop.id}/comments`, {
      method: "POST",
      body: { ...popover.value.pending, body, ...(isApp.value ? { page: page.value } : {}) },
    })
    popover.value = null
    send({ type: "clear-selection" })
    toast.add({ title: `Comment ${comment.n} added` })
    emit("refreshComments")
  }
  catch (error) {
    popoverRef.value?.fail()
    toast.add({ title: "Couldn't add the comment", description: errorText(error) })
  }
}

async function resolve(id: string, resolved: boolean) {
  await $fetch(`/api/comments/${id}`, { method: "PATCH", body: { resolved } }).catch(error => toast.add({ title: "Couldn't update", description: errorText(error) }))
  popover.value = null
  emit("refreshComments")
}

async function removeComment(id: string) {
  await $fetch(`/api/comments/${id}`, { method: "DELETE" }).catch(error => toast.add({ title: "Couldn't delete", description: errorText(error) }))
  popover.value = null
  emit("refreshComments")
}

function focusComment(comment: DropComment) {
  if (!isApp.value) return send({ type: "focus", id: comment.id })
  view.value = "preview"
  const move = comment.page && comment.page !== page.value
  if (move) page.value = comment.page!
  setTimeout(() => send({ type: "focus", id: comment.id }), move ? 600 : 0)
  if (!wide.value) mobileSide.value = false
}

async function deleteDrop() {
  if (!await confirm({ title: "Delete this drop?", description: `${props.drop.title}. Its link stops working and its comments go with it.`, confirmLabel: "Delete", destructive: true })) return
  try {
    await $fetch(`/api/drops/${props.drop.id}`, { method: "DELETE" })
    await refreshDrops()
    await navigateTo("/drops")
  }
  catch (error) {
    toast.add({ title: "Couldn't delete", description: errorText(error) })
  }
}

const treeRows = computed(() => {
  const key = (path: string) => path.split("/").map((part, index, parts) => (index < parts.length - 1 ? "0" : "1") + part.toLowerCase()).join("/")
  const rows: Array<{ path: string; name: string; depth: number; folder: boolean }> = []
  const folders = new Set<string>()
  for (const path of Object.keys(files.value).sort((a, b) => key(a).localeCompare(key(b)))) {
    const parts = path.split("/")
    for (let index = 1; index < parts.length; index++) {
      const folder = parts.slice(0, index).join("/")
      if (!folders.has(folder)) {
        folders.add(folder)
        rows.push({ path: folder, name: parts[index - 1]!, depth: index - 1, folder: true })
      }
    }
    rows.push({ path, name: parts.at(-1)!, depth: parts.length - 1, folder: false })
  }
  return rows
})
const imageComments = computed(() => (lightbox.value ? pageComments.value.filter(comment => comment.kind === "image" && comment.selector === lightbox.value!.selector) : []))
const threadComment = computed(() => (popover.value?.type === "thread" ? props.comments.find(comment => comment.id === (popover.value as { id: string }).id) : undefined))
</script>

<template>
  <DefineSide>
    <div class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-default pr-2 pl-2">
      <div class="flex min-w-0 items-center gap-0.5" role="tablist">
        <button
          v-for="item in tabs"
          :key="item.value"
          :aria-selected="tab === item.value"
          class="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors"
          :class="tab === item.value ? 'bg-elevated font-medium text-highlighted' : 'text-muted hover:text-highlighted'"
          role="tab"
          type="button"
          @click="tab = item.value"
        >
          {{ item.label }}
          <span v-if="item.count" class="font-mono text-[11px] text-dimmed tabular-nums">{{ item.count }}</span>
        </button>
      </div>
      <div class="flex items-center gap-1">
        <UButton v-if="tab === 'comments' && comments.length" aria-label="Copy feedback for your agent" color="neutral" icon="i-lucide-sparkles" size="sm" title="Copy feedback for your agent" variant="ghost" @click="copyFeedback" />
        <UButton v-if="tab === 'source' && drafts" aria-label="New file" color="neutral" icon="i-lucide-plus" size="sm" variant="ghost" @click="addFile" />
        <UButton aria-label="Close panel" color="neutral" icon="i-lucide-x" size="sm" variant="ghost" @click="wide ? (sideOpen = false) : (mobileSide = false)" />
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ViewerComments v-if="tab === 'comments'" :can-comment="drop.canComment" :can-manage="drop.isOwner" :comments="comments" @focus="focusComment" @resolve="resolve" />

      <div v-else-if="tab === 'source' && isApp" class="flex h-full flex-col">
        <ul class="min-h-0 flex-1 overflow-y-auto py-1.5 text-[13px]">
          <li v-for="row in treeRows" :key="row.path">
            <div v-if="row.folder" class="flex h-7 items-center gap-1.5 text-muted" :style="{ paddingLeft: `${12 + row.depth * 12}px` }">
              <UIcon name="i-lucide-folder" class="size-3.5" />{{ row.name }}
            </div>
            <button
              v-else
              class="group flex h-7 w-full cursor-pointer items-center gap-1.5 pr-2 text-left font-mono text-xs hover:bg-elevated"
              :class="(view === 'code' && file === row.path) || (view === 'preview' && page === row.path) ? 'bg-elevated text-highlighted' : 'text-muted'"
              :style="{ paddingLeft: `${12 + row.depth * 12}px` }"
              type="button"
              @click="openFile(row.path)"
            >
              <UIcon name="i-lucide-file" class="size-3.5 shrink-0" />
              <span class="truncate">{{ row.name }}</span>
              <span v-if="drafts && drafts[row.path] !== drop.files?.[row.path]" aria-label="Changed" class="ml-auto size-1.5 shrink-0 rounded-full bg-inverted" />
              <span
                v-if="row.path.endsWith('.html')"
                :aria-label="`Source of ${row.name}`"
                class="ml-auto hidden size-5 place-items-center rounded text-muted group-hover:grid hover:text-highlighted"
                role="button"
                @click.stop="file = row.path; view = 'code'"
              >
                <UIcon name="i-lucide-code" class="size-3" />
              </span>
            </button>
          </li>
        </ul>
        <div v-if="drop.canEdit && !drafts" class="border-t border-default p-2">
          <ViewerAction icon="i-lucide-pencil" label="Edit files" @click="startEdit" />
        </div>
      </div>

      <ViewerCode v-else-if="tab === 'source'" class="h-full" :path="drop.filename" :source="drop.content ?? (drop.url ?? '')">
        <template #actions>
          <UButton v-if="drop.canEdit" color="neutral" icon="i-lucide-pencil" label="Edit" size="sm" variant="ghost" @click="startEdit" />
        </template>
      </ViewerCode>

      <ViewerOverview v-else :drop="drop" @share="shareOpen = true">
        <template #actions>
          <ViewerAction v-if="drop.canEdit" icon="i-lucide-pencil" :label="isApp ? 'Edit files' : 'Edit'" @click="startEdit" />
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
          <UButton v-else aria-label="Back to drops" color="neutral" icon="i-lucide-arrow-left" variant="ghost" @click="editing ? cancelEdit() : navigateTo('/drops')" />
        </template>
        <template #title>
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate text-sm font-medium">{{ drop.title }}</span>
            <span v-if="editing" class="label-mono shrink-0">{{ saving ? "Publishing..." : dirty ? "Edited" : "Editing" }}</span>
          </span>
        </template>
        <template #right>
          <template v-if="editing">
            <UButton color="neutral" label="Cancel" size="sm" variant="ghost" @click="cancelEdit" />
            <UButton color="neutral" label="Publish" :loading="saving" size="sm" @click="save" />
          </template>
          <template v-else>
            <UButton v-if="owner" color="neutral" :icon="drop.visibility === 'shared' ? 'i-lucide-globe' : 'i-lucide-lock'" :label="drop.visibility === 'shared' ? 'Shared' : 'Share'" size="sm" :variant="drop.visibility === 'shared' ? 'outline' : 'solid'" @click="shareOpen = true" />
            <UButton v-else-if="publicView" class="hidden sm:inline-flex" color="neutral" label="Make Your Own" size="sm" to="/" variant="outline" />
            <span class="relative">
              <UButton :aria-label="sideOpen ? 'Hide panel' : 'Show panel'" :aria-pressed="sideOpen" color="neutral" icon="i-lucide-panel-right" :variant="sideOpen ? 'soft' : 'ghost'" @click="togglePanel" />
              <span v-if="openCount && !sideOpen" class="pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full bg-inverted ring-2 ring-(--ui-bg)" />
            </span>
          </template>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="isApp && view === 'preview'" class="flex h-9 shrink-0 items-center gap-2 border-b border-default px-3">
        <span class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-elevated px-2.5 py-1 font-mono text-xs text-muted">
          <UIcon :name="drop.visibility === 'shared' ? 'i-lucide-globe' : 'i-lucide-lock'" class="size-3 shrink-0" />
          <span class="truncate">/d/{{ drop.id.slice(0, 8) }}/{{ page === "index.html" ? "" : page }}</span>
        </span>
        <USelect v-if="pages.length > 1" v-model="page" class="w-40 font-mono" :items="pages" size="xs" />
      </div>

      <ViewerCode v-if="isApp && view === 'code'" :editable="Boolean(drafts)" :path="file" :source="files[file] ?? ''" @change="value => drafts && (drafts = { ...drafts, [file]: value })">
        <template #actions>
          <UButton color="neutral" icon="i-lucide-play" label="Preview" size="sm" variant="ghost" @click="view = 'preview'" />
        </template>
      </ViewerCode>
      <textarea
        v-else-if="docEdit?.mode === 'source'"
        v-model="docEdit.text"
        aria-label="Source"
        autofocus
        class="block size-full resize-none bg-default p-6 font-mono text-[13px] leading-relaxed text-highlighted outline-none"
        spellcheck="false"
      />
      <div v-else-if="drop.kind === 'file'" class="grid flex-1 place-items-center p-10 text-center">
        <div>
          <UIcon name="i-lucide-file" class="size-8 text-dimmed" />
          <p class="mt-3 font-mono text-sm">{{ drop.filename }}</p>
          <p class="mt-1 text-sm text-muted">No preview for this file type.</p>
          <UButton v-if="drop.url" class="mt-4" color="neutral" icon="i-lucide-download" label="Download" :to="drop.url" external target="_blank" variant="outline" />
        </div>
      </div>
      <iframe v-else-if="srcdoc" ref="frame" class="block min-h-0 w-full flex-1 bg-default" :sandbox="PREVIEW_SANDBOX" :srcdoc="srcdoc" :title="drop.title" />
    </template>
  </UDashboardPanel>

  <UDashboardPanel v-if="sideOpen && wide && !docEdit" id="drop-side" :default-size="24" :max-size="40" :min-size="18" resizable :ui="{ root: 'border-l border-default', body: 'p-0 sm:p-0 gap-0 overflow-hidden' }">
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

  <ViewerShareModal v-if="owner" v-model:open="shareOpen" :drop="drop" @changed="emit('refresh'); refreshDrops()" />
</template>
