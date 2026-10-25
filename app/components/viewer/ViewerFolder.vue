<script setup lang="ts">
// A folder's page: the drops in it as a list, like a file browser. On wide screens a click previews one beside the list
// (ViewerFolderPreview) and a second click, Enter or Open goes to its page: in the app for people signed in, at its share
// link on a public page. What goes in it (its description) is in Details (ViewerOverview). Everyone on the team adds to
// a team folder, by Upload, by pasting files, or by dropping them on the page; only admins add folders to it or change
// what it says.
import { breakpointsTailwind } from "@vueuse/core"
import { dropPath } from "#shared/links"
import type { DropDetail, DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropDetail; publicView?: boolean }>()
const { createBoard, createDoc, createFolder, createSite, upload } = useDropActions()
const folderDialog = useFolderDialog()
const siteDialog = useSiteDialog()
const children = computed(() => props.drop.children ?? [])
const to = (child: DropSummary) => (props.publicView ? dropPath(child) : `/drops/${child.id}`)
const meta = (child: DropSummary) =>
  [child.kind === "folder" ? itemCount(child.items ?? 0) : KIND_LABELS[child.kind], child.owner?.name]
    .filter(Boolean)
    .join(" · ")
// Search below the folder (ViewerFolderResults): signed-in people only, since it goes through /api/drops.
const { data: me } = useMe()
const search = ref("")
const live = computed(() => !props.drop.trashedAt)
const adds = computed(() => live.value && Boolean(me.value) && (props.drop.isOwner || Boolean(props.drop.teamFolder)))
const addsFolders = computed(() => props.drop.isOwner)
// ⌘K's new drops go in here too, where the New menu would put them.
offerToPalette("folder", () =>
  adds.value ? { id: props.drop.id, title: props.drop.title, folders: addsFolders.value } : null,
)

async function newFolder() {
  const input = await folderDialog({ inside: props.drop.title })
  if (input && (await createFolder(input.title, props.drop, { description: input.description })))
    await refreshNuxtData(keys.drop(props.drop.id))
}

// One click picks, the next opens. Below `lg` there's no room beside the list, so a click opens at once, and so do
// clicks with a modifier (a new tab) everywhere.
const wide = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 }).greaterOrEqual("lg")
const selected = ref<string | null>(null)
const picked = computed(() => (wide.value ? children.value.find((child) => child.id === selected.value) : undefined))
const list = useTemplateRef("list")
function pick(event: MouseEvent, child: DropSummary) {
  if (!wide.value || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  if (selected.value === child.id) void navigateTo(to(child))
  else selected.value = child.id
}
// Arrows walk the list with the preview following; Escape closes it.
function walk(event: KeyboardEvent) {
  if (event.key === "Escape" && selected.value) return void (selected.value = null)
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
  if (!step || !children.value.length) return
  event.preventDefault()
  const at = children.value.findIndex((child) => child.id === selected.value)
  const next = Math.min(children.value.length - 1, Math.max(0, at === -1 ? 0 : at + step))
  if (wide.value) selected.value = children.value[next]!.id
  list.value?.querySelectorAll("a")[next]?.focus()
}

// Upload, a paste, and files dropped on the page all land here, one after another. The last one shows in the preview;
// on a narrow screen a single file opens instead, as it did before the preview.
const uploading = ref(0)
async function uploadFiles(files: File[]) {
  if (!adds.value || !files.length) return
  uploading.value = files.length
  let last: { id: string } | undefined
  for (const file of files) {
    last = (await upload(file, props.drop)) ?? last
    uploading.value--
  }
  if (!last) return
  if (wide.value) selected.value = last.id
  else if (files.length === 1) await navigateTo(`/drops/${last.id}`)
}

const picker = useFileDialog({ multiple: true, reset: true })
picker.onChange((files) => void uploadFiles([...(files ?? [])]))

const root = useTemplateRef("root")
const { isOverDropZone } = useDropZone(root, {
  multiple: true,
  onDrop: (files) => void uploadFiles(files ?? []),
})
const dropping = computed(() => adds.value && isOverDropZone.value)

// A screenshot on the clipboard pastes as "image.png"; it gets the time instead, so a folder of them tells apart.
// Typing fields keep their paste.
useEventListener("paste", (event: ClipboardEvent) => {
  const target = event.target as HTMLElement | null
  if (!adds.value || target?.closest("input, textarea, [contenteditable]")) return
  const files = [...(event.clipboardData?.files ?? [])]
  if (!files.length) return
  event.preventDefault()
  // The reader's own clock, as "2026-10-25 11.30.12": Swedish dates read year first.
  const stamp = new Date().toLocaleString("sv-SE").replaceAll(":", ".")
  void uploadFiles(
    files.map((file) =>
      /^image\.\w+$/.test(file.name)
        ? new File([file], `Pasted ${stamp}.${file.name.split(".").pop()}`, { type: file.type })
        : file,
    ),
  )
})

async function newDoc() {
  const doc = await createDoc(props.drop)
  if (doc) await navigateTo(`/drops/${doc.id}?edit=1`)
}

async function newBoard() {
  const board = await createBoard(props.drop)
  if (board) await navigateTo(`/drops/${board.id}`)
}

async function newSite() {
  const input = await siteDialog()
  const site = input && (await createSite(input, props.drop))
  if (site) await navigateTo(`/drops/${site.id}`)
}
</script>

<template>
  <div ref="root" class="relative flex min-h-0 flex-1">
    <div class="min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-5xl p-4 sm:p-6">
        <!-- Search and the folder's actions share one bar; visitors, who can't search, see how much it holds instead. -->
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <UInput
            v-if="me && children.length"
            v-model="search"
            aria-label="Search this folder"
            class="w-full sm:w-auto sm:max-w-72 sm:min-w-48 sm:flex-1"
            icon="i-mingcute-search-line"
            :placeholder="`Search ${itemCount(children.length)}`"
          />
          <p v-else class="label-mono">{{ itemCount(children.length) }}</p>
          <div v-if="adds" class="flex items-center gap-1">
            <NewMenu :folder="addsFolders" @board="newBoard" @doc="newDoc" @folder="newFolder" @site="newSite" />
            <UTooltip text="Or paste files, or drop them on the page">
              <UButton
                color="neutral"
                icon="i-mingcute-upload-2-line"
                :label="uploading ? `Uploading ${uploading}…` : 'Upload'"
                :loading="uploading > 0"
                size="sm"
                variant="outline"
                @click="picker.open()"
              />
            </UTooltip>
          </div>
        </div>
        <ViewerFolderResults v-if="search.trim()" :folder="drop.id" :public-view="publicView" :query="search" />
        <div v-else-if="!children.length" class="rounded-lg border border-dashed border-default px-6 py-16 text-center">
          <UIcon name="i-mingcute-folder-open-line" class="size-6 text-dimmed" />
          <p class="mt-3 font-medium text-highlighted">Nothing in this folder yet</p>
          <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
            {{ adds ? "Drop or paste files here, upload them, ask" : "Ask" }} your agent to publish into
            {{ drop.title }}, or move a drop here with Move to folder in its menu.
          </p>
        </div>
        <ul
          v-else
          ref="list"
          :aria-label="`In ${drop.title}`"
          class="divide-y divide-default overflow-hidden rounded-lg border border-default"
          @keydown="walk"
        >
          <li v-for="child in children" :key="child.id">
            <NuxtLink
              :aria-current="picked?.id === child.id ? 'true' : undefined"
              class="flex items-center gap-3 px-3 py-2 transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted) focus-visible:ring-inset"
              :class="picked?.id === child.id ? 'bg-elevated' : 'hover:bg-muted'"
              :to="to(child)"
              @click.capture="pick($event, child)"
            >
              <span
                class="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-elevated text-muted ring-1 ring-default ring-inset"
              >
                <img
                  v-if="child.thumbnail"
                  alt=""
                  class="size-full object-cover"
                  loading="lazy"
                  :src="child.thumbnail"
                />
                <UIcon v-else :name="KIND_ICONS[child.kind]" class="size-4" />
              </span>
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted" :title="child.title">
                {{ child.title }}
              </span>
              <span class="hidden w-40 truncate text-xs text-muted sm:block">{{ meta(child) }}</span>
              <TimeAgo class="w-24 shrink-0 text-right text-xs text-muted tabular-nums" :at="child.updatedAt" />
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>
    <aside v-if="picked && !search.trim()" aria-label="Preview" class="w-80 shrink-0 border-l border-default xl:w-96">
      <ViewerFolderPreview :key="picked.id" :child="picked" :to="to(picked)" @close="selected = null" />
    </aside>
    <!-- Files dragged over the page: one target for the whole folder. -->
    <div
      v-if="dropping"
      class="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-lg border-2 border-dashed border-inverted bg-default/85"
    >
      <p class="flex items-center gap-2 text-sm font-medium text-highlighted">
        <UIcon name="i-mingcute-upload-2-line" class="size-4" />
        Drop to add to {{ drop.title }}
      </p>
    </div>
  </div>
</template>
