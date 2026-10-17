<script setup lang="ts">
import { TRASH_DAYS } from "#shared/expiry"
import { MIB, usageNearLimit } from "#shared/quotas"
import type { DropSummary } from "#shared/types"

definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Drops" })

const { data: drops, status, error, refresh } = useDrops()
const { upload, remove, restore, deleteForever, emptyTrash, createFolder } = useDropActions()
const prompt = usePrompt()
const open = useRowsOpen()
const { data: trash } = useApi("/api/drops", { key: "trash", query: { trash: 1 }, default: () => [] })
const { data: withMe } = useSharedWithMe()
const { data: usage } = useApi("/api/usage", { key: "usage" })
const limited = computed(() => usage.value?.enabled && [usage.value.drops, usage.value.bytes, usage.value.writes].some(quota => quota.limit !== null))
const nearLimit = computed(() => usage.value && usageNearLimit(usage.value))
const atLimit = computed(() => usage.value && [usage.value.drops, usage.value.bytes, usage.value.writes].some(quota => quota.limit !== null && quota.used >= quota.limit))
const storageMiB = computed(() => Math.ceil((usage.value?.bytes.used ?? 0) / MIB * 10) / 10)
const FILTERS = ["all", "private", "shared", "with-me", "trash"] as const
type Filter = typeof FILTERS[number]
// The tab lives in the URL so the sidebar can link straight to Shared with me.
const route = useRoute()
const filter = computed<Filter>({
  get: () => FILTERS.find(tab => tab === route.query.tab) ?? "all",
  set: tab => void navigateTo({ query: { ...route.query, tab: tab === "all" ? undefined : tab } }, { replace: true }),
})
const search = ref("")
const searchInput = useTemplateRef("searchInput")
const picker = useFileDialog({ multiple: false, reset: true })
picker.onChange(files => files?.[0] && void onPick(files[0]))
const now = useRelativeNow()

const counts = computed(() => ({
  all: drops.value.length,
  private: drops.value.filter(drop => drop.visibility === "private").length,
  shared: drops.value.filter(drop => drop.visibility !== "private").length,
  withMe: withMe.value.length,
  trash: trash.value.length,
}))

// Your own drops search on the server, inside every folder; the Trash and Shared with me filter what they list.
const query = refDebounced(computed(() => search.value.trim()), 200)
const deep = computed(() => Boolean(query.value) && filter.value !== "trash" && filter.value !== "with-me")
const { data: found, status: searching } = useApi<DropSummary[]>("/api/drops", { key: "drop-search", query: computed(() => ({ q: query.value })), default: () => [], immediate: false, server: false })

const visible = computed(() => {
  const words = search.value.trim().toLowerCase()
  const list = deep.value ? found.value : filter.value === "trash" ? trash.value : filter.value === "with-me" ? withMe.value : drops.value
  return list
    .filter(drop => filter.value !== "private" || drop.visibility === "private")
    .filter(drop => filter.value !== "shared" || drop.visibility !== "private")
    .filter(drop => deep.value || !words || `${drop.title} ${drop.filename} ${drop.actorName} ${drop.owner?.name ?? ""}`.toLowerCase().includes(words))
})

/**
 * Today, Yesterday, This week, then month names. The Worker renders in UTC, so the server render and hydration
 * group in UTC and the browser regroups in the reader's own timezone once mounted.
 */
const mounted = useMounted()
const groups = computed(() => {
  const timeZone = mounted.value ? undefined : "UTC"
  const start = new Date(now.value)
  if (timeZone) start.setUTCHours(0, 0, 0, 0)
  else start.setHours(0, 0, 0, 0)
  const label = (at: number) => {
    if (at >= start.getTime()) return "Today"
    if (at >= start.getTime() - 86_400_000) return "Yesterday"
    if (at >= start.getTime() - 6 * 86_400_000) return "This week"
    return new Date(at).toLocaleDateString("en", { timeZone, month: "long", year: "numeric" })
  }
  const out: Array<{ label: string; drops: DropSummary[] }> = []
  for (const drop of visible.value) {
    // The Trash groups by when things went there, which is also what sets when they're deleted.
    const name = label(filter.value === "trash" ? drop.trashedAt ?? drop.updatedAt : drop.updatedAt)
    const last = out.at(-1)
    if (last?.label === name) last.drops.push(drop)
    else out.push({ label: name, drops: [drop] })
  }
  return out
})

defineShortcuts({ "/": () => searchInput.value?.inputRef?.focus() })

async function onPick(file: File) {
  const result = await upload(file)
  if (result) await navigateTo(`/drops/${result.id}`)
}

async function newFolder() {
  const title = await prompt({ title: "New folder", label: "Name", placeholder: "Login review", confirmLabel: "Create" })
  if (title) await createFolder(title)
}
</script>

<template>
  <PageShell id="drops" title="Drops" description="Docs and apps you and your agents dropped. Private until you share them.">
    <template #actions>
      <UButton color="neutral" icon="i-ph-folder-simple-plus" label="New Folder" size="sm" variant="ghost" @click="newFolder" />
      <UButton color="neutral" icon="i-ph-upload-simple" label="Upload" size="sm" variant="outline" @click="picker.open()" />
    </template>

    <div v-if="usage && limited" class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default px-4 py-3" aria-live="polite">
      <div>
        <p class="text-sm tabular-nums text-highlighted">
          {{ usage.drops.used }}/{{ usage.drops.limit ?? '∞' }} drops · {{ storageMiB }}/{{ usage.bytes.limit === null ? '∞' : usage.bytes.limit / MIB }} MiB
        </p>
        <p class="mt-1 text-xs text-muted">
          {{ usage.writes.used }}/{{ usage.writes.limit ?? '∞' }} file writes this month<template v-if="nearLimit">. {{ atLimit ? 'At your plan limit.' : 'Near your plan limit.' }}</template>
        </p>
      </div>
      <div v-if="nearLimit" class="flex flex-wrap gap-2">
        <UButton color="neutral" label="Deploy your own" size="sm" :to="usage.selfHostUrl" variant="outline" />
      </div>
    </div>

    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <UTabs
        v-model="filter"
        :content="false"
        :items="[
          { label: `All ${counts.all}`, value: 'all' },
          { label: `Private ${counts.private}`, value: 'private', icon: 'i-ph-lock' },
          { label: `Shared ${counts.shared}`, value: 'shared', icon: 'i-ph-globe' },
          { label: `Shared with me ${counts.withMe}`, value: 'with-me', icon: 'i-ph-tray' },
          { label: `Trash ${counts.trash}`, value: 'trash', icon: 'i-ph-trash' },
        ]"
        size="sm"
        color="neutral"
      />
      <UInput ref="searchInput" v-model="search" class="w-full sm:w-72" icon="i-ph-magnifying-glass" placeholder="Search drops">
        <template #trailing><UKbd value="/" /></template>
      </UInput>
    </div>

    <div v-if="status === 'pending' && !drops.length" class="space-y-2">
      <USkeleton v-for="index in 4" :key="index" class="h-16 w-full" />
    </div>

    <div v-else-if="error" class="rounded-lg border border-dashed border-default px-6 py-16 text-center" role="alert">
      <UIcon name="i-ph-warning-circle" class="size-6 text-error" />
      <p class="mt-3 font-medium text-highlighted">Couldn't load your drops</p>
      <p class="mt-1 text-sm text-muted">Try again in a moment.</p>
      <UButton class="mt-5" color="neutral" label="Try again" variant="outline" @click="refresh()" />
    </div>

    <div v-else-if="filter === 'trash' && !trash.length" class="rounded-lg border border-dashed border-default px-6 py-16 text-center">
      <UIcon name="i-ph-trash" class="size-6 text-dimmed" />
      <p class="mt-3 font-medium text-highlighted">The Trash is empty</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted">Deleted and expired drops stay here for {{ TRASH_DAYS }} days, then they're gone for good.</p>
    </div>

    <div v-else-if="filter === 'with-me' && !withMe.length" class="rounded-lg border border-dashed border-default px-6 py-16 text-center">
      <UIcon name="i-ph-tray" class="size-6 text-dimmed" />
      <p class="mt-3 font-medium text-highlighted">Nothing shared with you yet</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted">Drops your teammates share with the team show up here, and so do links you open while signed in.</p>
    </div>

    <div v-else-if="filter !== 'trash' && filter !== 'with-me' && !drops.length" class="rounded-lg border border-dashed border-default px-6 py-16 text-center">
      <UIcon name="i-ph-stack" class="size-6 text-dimmed" />
      <p class="mt-3 font-medium text-highlighted">Nothing dropped yet</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted">Connect an agent and it drops plans, specs, and small apps here.</p>
      <UButton class="mt-5" color="neutral" label="Connect an Agent" to="/agents?tab=mcp" />
    </div>

    <p v-else-if="!visible.length" class="py-16 text-center text-sm text-muted">{{ deep && searching === 'pending' ? "Searching…" : "No drops match." }}</p>

    <div v-if="filter === 'trash' && trash.length" class="mb-3 flex items-center justify-between gap-3 text-sm text-muted">
      <p>Drops in the Trash are deleted for good {{ TRASH_DAYS }} days after they got here.</p>
      <UButton color="error" label="Empty Trash" size="sm" variant="outline" @click="emptyTrash(trash.length)" />
    </div>

    <div v-if="visible.length" class="overflow-hidden rounded-lg border border-default">
      <template v-for="group in groups" :key="group.label">
        <p class="label-mono border-b border-default bg-muted px-4 py-2">{{ group.label }}</p>
        <ul class="divide-y divide-default border-b border-default last:border-b-0">
          <template v-for="drop in group.drops" :key="drop.id">
            <DropRow :drop="drop" :open="open[drop.id]" @delete="remove(drop)" @restore="restore(drop)" @delete-forever="deleteForever(drop)" @toggle="open[drop.id] = !open[drop.id]" />
            <!-- A folder opens in place, except in the Trash, where it comes back whole (DropRow shows no toggle there). -->
            <DropFolderRows v-if="drop.kind === 'folder' && open[drop.id] && !drop.trashedAt" :id="drop.id" :depth="1" />
          </template>
        </ul>
      </template>
    </div>

  </PageShell>
</template>
