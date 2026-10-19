<script setup lang="ts">
// A folder's page: what goes in it (its description, which agents read too), then the drops in it as a grid, images as
// thumbnails, the rest by kind. Each opens its own page: in the app for people signed in, at its share link on a public
// page. Everyone on the team adds to a team folder; only admins add folders to it or change what it says.
import { dropPath } from "#shared/links"
import type { DropDetail, DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropDetail; publicView?: boolean }>()
const { createFolder, createSite, describe, upload } = useDropActions()
const folderDialog = useFolderDialog()
const siteDialog = useSiteDialog()
const children = computed(() => props.drop.children ?? [])
const to = (child: DropSummary) => (props.publicView ? dropPath(child) : `/drops/${child.id}`)
const meta = (child: DropSummary) => [child.kind === "folder" ? itemCount(child.items ?? 0) : KIND_LABELS[child.kind] ?? "File", child.owner?.name].filter(Boolean).join(" · ")
// Search below the folder (ViewerFolderResults): signed-in people only, since it goes through /api/drops.
const { data: me } = useMe()
const search = ref("")
const live = computed(() => !props.drop.trashedAt)
const adds = computed(() => live.value && Boolean(me.value) && (props.drop.isOwner || Boolean(props.drop.teamFolder)))
const addsFolders = computed(() => props.drop.isOwner)

// The description, edited in place by whoever may change the folder.
const editing = ref(false)
const draft = ref("")
const saving = ref(false)
function startEditing() {
  draft.value = props.drop.note ?? ""
  editing.value = true
}
async function save() {
  saving.value = true
  if (await describe(props.drop, draft.value)) editing.value = false
  saving.value = false
}

async function newFolder() {
  const input = await folderDialog({ inside: props.drop.title })
  if (input && await createFolder(input.title, props.drop, { description: input.description })) await refreshNuxtData(`drop:${props.drop.id}`)
}

const picker = useFileDialog({ multiple: false, reset: true })
picker.onChange(async (files) => {
  const result = files?.[0] && await upload(files[0], props.drop)
  if (result) await navigateTo(`/drops/${result.id}`)
})

async function newSite() {
  const input = await siteDialog()
  const site = input && await createSite(input, props.drop)
  if (site) await navigateTo(`/drops/${site.id}`)
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <!-- What goes here: for the people browsing it and the agents filing into it (list_folders). -->
      <section v-if="me && !publicView && (drop.note || (drop.isOwner && live))" aria-label="What goes here" class="mb-5 rounded-lg border border-default bg-muted/40 px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <p class="label-mono flex items-center gap-1.5"><UIcon v-if="drop.teamFolder" name="i-ph-users" class="size-3.5" />{{ drop.teamFolder ? "The team's folder · What goes here" : "What goes here" }}</p>
          <UButton v-if="drop.isOwner && live && !editing" class="-my-1" color="neutral" :label="drop.note ? 'Edit' : 'Describe'" size="xs" variant="ghost" @click="startEditing" />
        </div>
        <form v-if="editing" class="mt-2 space-y-2" @submit.prevent="save">
          <UTextarea v-model="draft" aria-label="What goes here" autofocus autoresize class="w-full" :maxlength="2000" :maxrows="12" placeholder="What belongs here, and how to name and write it. Agents read this to file things in the right place." :rows="3" />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" label="Cancel" size="sm" variant="ghost" @click="editing = false" />
            <UButton color="neutral" label="Save" :loading="saving" size="sm" type="submit" />
          </div>
        </form>
        <p v-else-if="drop.note" class="mt-1.5 text-sm whitespace-pre-line text-highlighted">{{ drop.note }}</p>
        <p v-else class="mt-1.5 text-sm text-muted">Say what belongs here and how to name it. Agents read this to file things in the right place.</p>
      </section>

      <!-- Search and the folder's actions share one bar; visitors, who can't search, see how much it holds instead. -->
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <UInput v-if="me && children.length" v-model="search" aria-label="Search this folder" class="w-full sm:w-auto sm:max-w-72 sm:min-w-48 sm:flex-1" icon="i-ph-magnifying-glass" :placeholder="`Search ${itemCount(children.length)}`" />
        <p v-else class="label-mono">{{ itemCount(children.length) }}</p>
        <div v-if="adds" class="flex items-center gap-1">
          <NewMenu :folder="addsFolders" @folder="newFolder" @site="newSite" />
          <UButton color="neutral" icon="i-ph-upload-simple" label="Upload" size="sm" variant="outline" @click="picker.open()" />
        </div>
      </div>
      <ViewerFolderResults v-if="search.trim()" :folder="drop.id" :public-view="publicView" :query="search" />
      <div v-else-if="!children.length" class="rounded-lg border border-dashed border-default px-6 py-16 text-center">
        <UIcon name="i-ph-folder-open" class="size-6 text-dimmed" />
        <p class="mt-3 font-medium text-highlighted">Nothing in this folder yet</p>
        <p class="mx-auto mt-1 max-w-sm text-sm text-muted">Upload a file, ask your agent to publish into {{ drop.title }}, or move a drop here with Move to folder in its menu.</p>
      </div>
      <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <li v-for="child in children" :key="child.id">
          <NuxtLink class="group block overflow-hidden rounded-lg border border-default bg-default transition-colors hover:bg-muted" :to="to(child)">
            <div class="grid aspect-4/3 place-items-center overflow-hidden border-b border-default bg-elevated">
              <img v-if="child.thumbnail" :alt="child.title" class="size-full object-cover" loading="lazy" :src="child.thumbnail">
              <UIcon v-else :name="KIND_ICONS[child.kind] ?? 'i-ph-file'" class="size-8 text-dimmed" />
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
