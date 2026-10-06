<script setup lang="ts">
// The drop viewer (T3 Code's layout): a main column with its own header, and one full-height side panel with
// tabs (Comments, Source or Files, Details) that pushes the content. Docs and apps share it. State lives in
// composables (useDrop, useViewerPanel, useDropEditor, useAppFiles, useDropFrame); this file wires them up.
import { editorDocument, planDocument } from "#shared/documents"
import { injectRuntime } from "#shared/plan-runtime"
import type { PlanKind } from "#shared/plans"
import { buildProjectDocument } from "#shared/project-bundle"
import { FilePathSchema } from "#shared/schemas"
import type { DropComment } from "#shared/types"
import type { PendingComment } from "./viewer/ViewerCommentPopover.vue"

type Selection = { quote: string; selector: string; label: string; rect: { left: number; top: number; right: number; bottom: number } }
type Lightbox = { src: string; alt: string; selector: string; label: string }
type Popover = { x: number; y: number } & ({ type: "new"; pending: PendingComment } | { type: "thread"; id: string })

const props = withDefaults(defineProps<{ publicView?: boolean }>(), { publicView: false })

const state = injectDrop()!
const drop = computed(() => state.drop.data.value!)
const comments = computed(() => state.comments.data.value)

const route = useRoute()
const notify = useNotify()
const prompt = usePrompt()
const { copy } = useCopy()
const { remove } = useDropActions()
const colorMode = useColorMode()
const dark = computed(() => colorMode.value === "dark")
const [DefineSide, ReuseSide] = createReusableTemplate()
const { width: windowWidth } = useWindowSize()

const isApp = computed(() => drop.value.kind === "app")
const owner = computed(() => drop.value.isOwner && !props.publicView)
const openCount = computed(() => comments.value.filter(comment => !comment.resolved).length)
const link = computed(() => (import.meta.client ? `${location.origin}/d/${drop.value.id}` : `/d/${drop.value.id}`))

const panel = useViewerPanel({ isApp, owner, openCount, fileCount: computed(() => drop.value.paths?.length) })
const { wide, sideOpen, mobileSide, tabs, tab } = panel
const editor = useDropEditor(drop, { publicView: props.publicView, publish: state.publish, onAppPublished: () => (view.value = "preview") })
const { docEdit, editorSource, drafts, editing, dirty, saving } = editor
const { files, pages, page, view, file, treeRows, openFile } = useAppFiles(drop, drafts)

// Images load into the sandbox as data URLs: the opaque-origin frame can't send your session cookie.
const imageBlob = shallowRef<Blob>()
const { base64: imageData } = useBase64(imageBlob)
onMounted(async () => {
  if (drop.value.kind !== "image" || !drop.value.url) return
  imageBlob.value = await $fetch<Blob>(drop.value.url, { responseType: "blob" }).catch(() => undefined)
})

// Live app preview while editing, debounced so typing doesn't reload the app on every key.
const previewFiles = refDebounced(files, () => (drafts.value ? 450 : 0))

const srcdoc = computed(() => {
  if (isApp.value) return injectRuntime(buildProjectDocument(previewFiles.value, page.value), dark.value)
  if (docEdit.value?.mode === "rich") return editorDocument(editorSource.value, dark.value)
  if (drop.value.kind === "image") return imageData.value ? planDocument("image", imageData.value, dark.value) : ""
  return planDocument(drop.value.kind as PlanKind, drop.value.content ?? "", dark.value, drop.value.html)
})

const frame = useTemplateRef<HTMLIFrameElement>("frame")
const selection = ref<Selection | null>(null)
const lightbox = ref<Lightbox | null>(null)
const popover = ref<Popover | null>(null)
const popoverRef = useTemplateRef<{ fail: () => void }>("popoverRef")
const shareOpen = ref(false)

const pageComments = computed(() => (isApp.value ? comments.value.filter(comment => comment.page === page.value || (!comment.page && page.value === pages.value[0])) : comments.value))

const { ready, send } = useDropFrame(frame, (message, rect) => {
  if (message.type === "navigate" && isApp.value) page.value = message.path
  if (message.type === "copy") void copy(message.text, "Code copied")
  if (message.type === "edit-change" && docEdit.value) docEdit.value.text = message.markdown
  if (message.type === "edit-save") void editor.save()
  if (message.type === "edit-error" && docEdit.value) {
    notify.info({ title: "The editor couldn't load", description: "Editing the Markdown source instead." })
    docEdit.value.mode = "source"
  }
  if (message.type === "selection" && drop.value.canComment && !editing.value) {
    selection.value = message.clear ? null : {
      quote: message.quote, selector: message.selector, label: message.label,
      rect: { left: rect.left + message.rect.left, top: rect.top + message.rect.top, right: rect.left + message.rect.right, bottom: rect.top + message.rect.bottom },
    }
  }
  if (message.type === "image" && !editing.value) lightbox.value = { src: message.src, alt: message.alt, selector: message.selector, label: message.label }
  if (message.type === "marker") popover.value = { type: "thread", id: message.id, x: rect.left + message.clientX, y: rect.top + message.clientY }
  if (message.type === "key" && message.key === "Escape") popover.value = selection.value = null
})
watch(srcdoc, () => (ready.value = false))
watch([ready, pageComments], () => {
  if (ready.value && !docEdit.value) send({ type: "markers", markers: pageComments.value.map(({ id, n, kind, selector, ox, oy, quote, resolved }) => ({ id, n, kind, selector, ox, oy, quote, resolved })) })
})

defineShortcuts({
  meta_s: { usingInput: true, handler: () => editing.value && void editor.save() },
  escape: { usingInput: true, handler: () => (popover.value = selection.value = null) },
  c: () => !editing.value && panel.show("comments"),
})
onMounted(() => {
  if (route.query.edit === "1" && drop.value.canEdit) startEdit()
})

const copyFeedback = () => copy(feedbackMarkdown(drop.value.title, link.value, comments.value), "Feedback copied as Markdown")
function copyLink() {
  if (drop.value.visibility === "shared") void copy(link.value, "Link copied")
  else shareOpen.value = true
}

function startEdit() {
  popover.value = selection.value = null
  editor.start()
  if (isApp.value) panel.show("source")
}
const cancelEdit = editor.cancel
const save = editor.save
const togglePanel = panel.toggle

async function addFile() {
  const path = await editor.addFile(await prompt({ title: "New file", label: "Path", placeholder: "components/button.js", confirmLabel: "Add File", schema: FilePathSchema.entries.path }))
  if (path) openFile(path)
}

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
  view.value = "preview"
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
        <UButton aria-label="Close panel" color="neutral" icon="i-lucide-x" size="sm" variant="ghost" @click="panel.close" />
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

  <ViewerShareModal v-if="owner" v-model:open="shareOpen" :drop="drop" />
</template>
