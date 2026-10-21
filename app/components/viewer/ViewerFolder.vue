<script setup lang="ts">
// A folder's page: the drops in it as a grid, images as thumbnails, the rest by kind. What goes in it (its description)
// is in Details (ViewerOverview). Each opens its own page: in the app for people signed in, at its share link on a public
// page. Everyone on the team adds to a team folder; only admins add folders to it or change what it says.
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

const picker = useFileDialog({ multiple: false, reset: true })
picker.onChange((files) => void uploadPicked(files))
async function uploadPicked(files: FileList | null) {
  const result = files?.[0] && (await upload(files[0], props.drop))
  if (result) await navigateTo(`/drops/${result.id}`)
}

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
  <div class="min-h-0 flex-1 overflow-y-auto">
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
          <UButton
            color="neutral"
            icon="i-mingcute-upload-2-line"
            label="Upload"
            size="sm"
            variant="outline"
            @click="picker.open()"
          />
        </div>
      </div>
      <ViewerFolderResults v-if="search.trim()" :folder="drop.id" :public-view="publicView" :query="search" />
      <div v-else-if="!children.length" class="rounded-lg border border-dashed border-default px-6 py-16 text-center">
        <UIcon name="i-mingcute-folder-open-line" class="size-6 text-dimmed" />
        <p class="mt-3 font-medium text-highlighted">Nothing in this folder yet</p>
        <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
          Upload a file, ask your agent to publish into {{ drop.title }}, or move a drop here with Move to folder in its
          menu.
        </p>
      </div>
      <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <li v-for="child in children" :key="child.id">
          <NuxtLink
            class="group block overflow-hidden rounded-lg border border-default bg-default transition-colors hover:bg-muted"
            :to="to(child)"
          >
            <div class="grid aspect-4/3 place-items-center overflow-hidden border-b border-default bg-elevated">
              <img
                v-if="child.thumbnail"
                :alt="child.title"
                class="size-full object-cover"
                loading="lazy"
                :src="child.thumbnail"
              />
              <UIcon v-else :name="KIND_ICONS[child.kind]" class="size-8 text-dimmed" />
            </div>
            <div class="min-w-0 px-3 py-2.5">
              <p class="truncate text-sm font-medium text-highlighted" :title="child.title">{{ child.title }}</p>
              <p class="mt-0.5 truncate text-xs text-muted">{{ meta(child) }} · <TimeAgo :at="child.updatedAt" /></p>
            </div>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
