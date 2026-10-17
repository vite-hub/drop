<script setup lang="ts">
// A folder's page: the drops in it as a grid, images as thumbnails, the rest by kind. Each opens its own page: in the
// app for people signed in, at its share link on a public page.
import { dropPath } from "#shared/links"
import type { DropDetail, DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropDetail; publicView?: boolean }>()
const { createFolder, createSite } = useDropActions()
const prompt = usePrompt()
const siteDialog = useSiteDialog()
const children = computed(() => props.drop.children ?? [])
const to = (child: DropSummary) => (props.publicView ? dropPath(child) : `/drops/${child.id}`)
const meta = (child: DropSummary) => (child.kind === "folder" ? itemCount(child.items ?? 0) : KIND_LABELS[child.kind] ?? "File")

async function newFolder() {
  const title = await prompt({ title: "New folder", label: "Name", placeholder: "Screenshots", confirmLabel: "Create" })
  if (title && await createFolder(title, props.drop)) await refreshNuxtData(`drop:${props.drop.id}`)
}

async function newSite() {
  const input = await siteDialog()
  const site = input && await createSite(input, props.drop)
  if (site) await navigateTo(`/drops/${site.id}`)
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div class="mb-4 flex h-8 items-center justify-between gap-3">
        <p class="label-mono">{{ itemCount(children.length) }}</p>
        <div v-if="drop.isOwner && !drop.trashedAt" class="flex items-center gap-1">
          <UButton color="neutral" icon="i-ph-folder-simple-plus" label="New Folder" size="sm" variant="ghost" @click="newFolder" />
          <UButton color="neutral" icon="i-ph-globe-simple" label="New Site Review" size="sm" variant="ghost" @click="newSite" />
        </div>
      </div>
      <div v-if="!children.length" class="rounded-lg border border-dashed border-default px-6 py-16 text-center">
        <UIcon name="i-ph-folder-open" class="size-6 text-dimmed" />
        <p class="mt-3 font-medium text-highlighted">Nothing in this folder yet</p>
        <p class="mx-auto mt-1 max-w-sm text-sm text-muted">Ask your agent to publish into {{ drop.title }}, or move a drop here with Move to folder in its menu.</p>
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
