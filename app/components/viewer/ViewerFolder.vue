<script setup lang="ts">
// A folder's page: the drops in it as a list, like a file browser. On wide screens a click previews one beside the list
// (ViewerFolderPreview, its width dragged from its edge) and a double-click, Enter or Open goes to its page: in the app
// for people signed in, at its share link on a public page. As in Finder, a slower second click on a picked drop's name,
// F2, or Rename in its right-click menu renames it. What goes in the folder (its description) is in Details
// (ViewerOverview). Everyone on the team adds to a team folder, by Upload, by pasting files, or by dropping them on the
// page; only admins add folders to it or change what it says.
import { breakpointsTailwind } from "@vueuse/core"
import { dropPath } from "#shared/links"
import type { DropDetail, DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropDetail; publicView?: boolean }>()
const { createBoard, createDoc, createFolder, createSite, upload, rename, remove } = useDropActions()
const folderDialog = useFolderDialog()
const siteDialog = useSiteDialog()
const children = computed(() => props.drop.children ?? [])
const to = (child: DropSummary) => (props.publicView ? dropPath(child) : `/drops/${child.id}`)
const [DefineRowParts, ReuseRowParts] = createReusableTemplate<{ child: DropSummary; part: "icon" | "meta" }>()
const meta = (child: DropSummary) =>
  [child.kind === "folder" ? itemCount(child.items ?? 0) : KIND_LABELS[child.kind], child.owner?.name]
    .filter(Boolean)
    .join(" · ")
// Search goes to the ⌘K palette with `in:<folder>` typed in, where kinds and other folders filter too. A public page
// has no palette, so signed-in people search below the folder there (ViewerFolderResults). Both go through /api/drops.
const { data: me } = useMe()
const palette = Boolean(injectPaletteContext())
const openPalette = usePaletteOpener()
const searchable = computed(() => Boolean(me.value) && children.value.length > 0)
const search = ref("")
const searchFolder = () => openPalette(`${inFolder(props.drop.title)} `)
offerToPalette("scope", () => (me.value ? { id: props.drop.id, title: props.drop.title } : null))
defineShortcuts({ "/": () => palette && searchable.value && searchFolder() })
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

// One click picks, a double-click opens. Below `lg` there's no room beside the list, so a click opens at once, and so do
// clicks with a modifier (a new tab) everywhere, and Enter on a row (a click with no `detail`).
const wide = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 }).greaterOrEqual("lg")
const selected = ref<string | null>(null)
const picked = computed(() => (wide.value ? children.value.find((child) => child.id === selected.value) : undefined))
const list = useTemplateRef("list")
const rowOf = (id: string) => list.value?.querySelector<HTMLElement>(`[data-id="${id}"]`)
let pickedAt = 0
let slowClick: ReturnType<typeof setTimeout> | undefined
function pick(event: MouseEvent, child: DropSummary) {
  if (!wide.value || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || !event.detail) return
  event.preventDefault()
  clearTimeout(slowClick)
  if (event.detail > 1) return void navigateTo(to(child))
  if (selected.value !== child.id) {
    selected.value = child.id
    pickedAt = event.timeStamp
    return
  }
  // A second click on the name, slower than a double-click, renames: it waits out the double-click first.
  const onName = event.target instanceof Element && event.target.closest("[data-name]")
  if (onName && event.timeStamp - pickedAt > 500) slowClick = setTimeout(() => startRename(child), 500)
}
onBeforeUnmount(() => clearTimeout(slowClick))

// Renaming: the folder's owner (or a team folder's drop's), and admins. The new name shows at once; it goes back if the
// server says no.
const manages = (child: DropSummary) =>
  Boolean(me.value) &&
  !props.publicView &&
  live.value &&
  (me.value?.role === "admin" || (props.drop.teamFolder ? !child.owner && !child.teamFolder : props.drop.isOwner))
// In a team folder anyone may move a teammate's drop to the Trash, as on the Drops page.
const trashes = (child: DropSummary) => manages(child) || (adds.value && Boolean(props.drop.teamFolder))
const renaming = ref<string | null>(null)
const titles = ref<Record<string, string>>({})
const nameOf = (child: DropSummary) => titles.value[child.id] ?? child.title
function startRename(child: DropSummary) {
  clearTimeout(slowClick)
  if (manages(child)) renaming.value = child.id
}
async function renamed(child: DropSummary, title: string | null) {
  const focused = renaming.value === child.id
  renaming.value = null
  if (focused) void nextTick(() => rowOf(child.id)?.focus())
  if (!title) return
  titles.value = { ...titles.value, [child.id]: title }
  if (await rename(child, title)) await refreshNuxtData(keys.drop(props.drop.id))
  const { [child.id]: _, ...rest } = titles.value
  titles.value = rest
}

// Right-click (or the menu key) on a row: what the Drops page's row menu does, and Rename. The row picks itself, so the
// preview shows what the menu acts on.
const moveTo = useMoveDialog()
const { copy } = useCopy()
const origin = useRequestURL().origin
const menuDrop = shallowRef<DropSummary | null>(null)
function aim(event: MouseEvent) {
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-id]") : null
  const child = children.value.find((item) => item.id === row?.dataset.id)
  // A field being renamed keeps the browser's own menu, and so does the space between rows.
  if (!child || (event.target instanceof Element && event.target.closest("input"))) return event.stopPropagation()
  menuDrop.value = child
  if (wide.value) selected.value = child.id
}
const menu = computed(() => {
  const child = menuDrop.value
  if (!child) return []
  return [
    [
      { label: "Open", icon: "i-mingcute-arrow-right-up-line", onSelect: () => void navigateTo(to(child)) },
      { label: "Open in new tab", icon: "i-mingcute-external-link-line", to: to(child), target: "_blank" },
    ],
    [
      ...(manages(child)
        ? [{ label: "Rename", icon: "i-mingcute-edit-2-line", kbds: ["F2"], onSelect: () => (renameNext = child) }]
        : []),
      {
        label: "Copy link",
        icon: "i-mingcute-link-line",
        onSelect: () => void copy(`${origin}${dropPath(child)}`, { announce: "Link copied" }),
      },
      ...(manages(child)
        ? [
            {
              label: "Move to folder",
              icon: "i-mingcute-new-folder-line",
              onSelect: () => void moveTo({ drop: child }),
            },
          ]
        : []),
    ],
    ...(trashes(child)
      ? [[{ label: "Move to Trash", icon: "i-mingcute-delete-2-line", onSelect: () => void trash(child) }]]
      : []),
  ]
})
// Rename waits for the menu to close: its focus trap would take the focus back from the field. Otherwise the focus goes
// back to the row, unless a dialog the menu opened (Move to folder) has it.
let renameNext: DropSummary | null = null
function menuClosed(event: Event) {
  event.preventDefault()
  if (renameNext) startRename(renameNext)
  else if (menuDrop.value && !document.activeElement?.closest("[role=dialog]")) rowOf(menuDrop.value.id)?.focus()
  renameNext = null
}
async function trash(child: DropSummary) {
  if (!(await remove(child))) return
  if (selected.value === child.id) selected.value = null
  await refreshNuxtData(keys.drop(props.drop.id))
}

// The preview's width, dragged from its left edge, kept for every folder.
const preview = useResizeHandle(useFolderPreviewWidth(), { min: 18, max: 40, initial: 22 })
const previewing = computed(() => Boolean(picked.value && !search.value.trim()))
// The list stays centered on the whole page while the preview is open, so opening or resizing it doesn't move the
// list's left edge: the preview takes its room from the list's right.
const listStyle = computed(() =>
  previewing.value
    ? { marginLeft: `max(0px, (100% + ${preview.width.value}rem + 1px - var(--container-5xl)) / 2)` }
    : undefined,
)

// Arrows walk the list with the preview following; Escape closes it; F2 renames the row in focus.
function walk(event: KeyboardEvent) {
  if (event.key === "F2") {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-id]") : null
    const child = children.value.find((item) => item.id === row?.dataset.id)
    if (child && manages(child)) {
      event.preventDefault()
      startRename(child)
    }
    return
  }
  if (event.key === "Escape" && selected.value) return void (selected.value = null)
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
  if (!step || !children.value.length) return
  event.preventDefault()
  const at = children.value.findIndex((child) => child.id === selected.value)
  const next = Math.min(children.value.length - 1, Math.max(0, at === -1 ? 0 : at + step))
  if (wide.value) selected.value = children.value[next]!.id
  rowOf(children.value[next]!.id)?.focus()
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
  const target = event.target instanceof Element ? event.target : null
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
  <!-- A row's icon and its kind and time, the same whether it links or its name is being edited. -->
  <DefineRowParts v-slot="{ child, part }">
    <!-- An image shows its top, the header of a screenshot, with a hairline so a white one keeps its edge; the rest get
         their kind's icon. The image's own size, not the grid's auto row, sets its box: a tall screenshot would
         stretch that row past the 28px and over the rows below. -->
    <span v-if="part === 'icon'" class="grid size-7 shrink-0 place-items-center">
      <img
        v-if="child.thumbnail"
        alt=""
        class="size-7 rounded-md object-cover object-top outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        loading="lazy"
        :src="child.thumbnail"
      />
      <span
        v-else
        class="grid size-full place-items-center rounded-md bg-elevated text-muted ring-1 ring-default ring-inset"
      >
        <UIcon :name="KIND_ICONS[child.kind]" class="size-4" />
      </span>
    </span>
    <template v-else>
      <span class="hidden w-40 truncate text-xs text-muted sm:block">{{ meta(child) }}</span>
      <TimeAgo class="w-24 shrink-0 text-right text-xs text-muted tabular-nums" :at="child.updatedAt" />
    </template>
  </DefineRowParts>
  <div ref="root" class="relative flex min-h-0 flex-1">
    <div class="min-w-0 flex-1 overflow-y-auto">
      <div class="max-w-5xl px-4 py-3 sm:px-6 sm:py-4" :class="{ 'mx-auto': !previewing }" :style="listStyle">
        <!-- Search and the folder's actions share one bar; visitors, who can't search, see how much it holds instead.
             The search box is a button that opens ⌘K on this folder. -->
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <button
            v-if="searchable && palette"
            class="flex h-8 w-full cursor-text items-center gap-2 rounded-md px-2.5 text-sm text-dimmed ring-1 ring-default ring-inset transition-colors hover:bg-elevated/50 hover:text-muted focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted) focus-visible:outline-none sm:w-64"
            type="button"
            @click="searchFolder"
          >
            <UIcon class="size-4 shrink-0" name="i-mingcute-search-line" />
            <span class="min-w-0 flex-1 truncate text-left">Search {{ itemCount(children.length) }}</span>
            <UKbd value="/" />
          </button>
          <UInput
            v-else-if="searchable"
            v-model="search"
            aria-label="Search this folder"
            class="w-full sm:w-64"
            icon="i-mingcute-search-line"
            :placeholder="`Search ${itemCount(children.length)}`"
            size="sm"
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
        <template v-else>
          <!-- Column names give the quiet rows their grid. -->
          <div
            aria-hidden="true"
            class="-mx-2 flex items-center gap-3 border-b border-default px-2 pb-1.5 text-xs text-dimmed"
          >
            <span class="w-7 shrink-0" />
            <span class="flex-1">Name</span>
            <span class="hidden w-40 sm:block">Kind</span>
            <span class="w-24 shrink-0 text-right">Updated</span>
          </div>
          <UContextMenu :content="{ onCloseAutoFocus: menuClosed }" :external-icon="false" :items="menu">
            <ul
              ref="list"
              :aria-label="`In ${drop.title}`"
              class="-mx-2 mt-1 flex flex-col gap-px"
              @contextmenu.capture="aim"
              @keydown="walk"
            >
              <li v-for="child in children" :key="child.id">
                <div
                  v-if="renaming === child.id"
                  class="flex items-center gap-3 rounded-md bg-accented/70 px-2 py-1.5"
                  :data-id="child.id"
                >
                  <ReuseRowParts :child part="icon" />
                  <div class="min-w-0 flex-1">
                    <ViewerRename
                      :label="`Rename ${child.title}`"
                      :title="child.title"
                      @done="renamed(child, $event)"
                    />
                  </div>
                  <ReuseRowParts :child part="meta" />
                </div>
                <NuxtLink
                  v-else
                  :aria-current="picked?.id === child.id ? 'true' : undefined"
                  class="flex items-center gap-3 rounded-md px-2 py-1.5 outline-none select-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted) focus-visible:ring-inset"
                  :class="picked?.id === child.id ? 'bg-accented/70' : 'hover:bg-elevated'"
                  :data-id="child.id"
                  draggable="false"
                  :to="to(child)"
                  @click.capture="pick($event, child)"
                >
                  <ReuseRowParts :child part="icon" />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
                    <span data-name>{{ nameOf(child) }}</span>
                  </span>
                  <ReuseRowParts :child part="meta" />
                </NuxtLink>
              </li>
            </ul>
          </UContextMenu>
        </template>
      </div>
    </div>
    <template v-if="picked && previewing">
      <!-- The pane's left border is its handle: drag it, double-click it to reset, or focus it and use the arrows. -->
      <div
        aria-label="Resize the preview"
        aria-orientation="vertical"
        :aria-valuemax="40"
        :aria-valuemin="18"
        :aria-valuenow="preview.width.value"
        class="group relative z-10 w-px shrink-0 cursor-col-resize bg-(--ui-border) outline-none after:absolute after:inset-y-0 after:-left-1.5 after:w-3 hover:bg-(--ui-border-inverted)/40 focus-visible:bg-(--ui-border-inverted)"
        role="separator"
        tabindex="0"
        v-bind="preview.handle"
      />
      <aside aria-label="Preview" class="shrink-0" :style="{ width: `${preview.width.value}rem` }">
        <ViewerFolderPreview
          :key="picked.id"
          :child="picked"
          :renames="manages(picked)"
          :title="nameOf(picked)"
          :to="to(picked)"
          @close="selected = null"
          @rename="renamed(picked, $event)"
        />
      </aside>
    </template>
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
