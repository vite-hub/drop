<script setup lang="ts">
import { MIB, usageNearLimit, type Usage } from "#shared/quotas"
import type { DropSummary } from "#shared/types"

definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Drops" })

const { drops, status, error, refresh, create, upload, remove } = useDrops()
const { data: usage, refresh: refreshUsage } = useApi<Usage>("/api/usage", { key: "usage" })
const nearLimit = computed(() => usage.value && usageNearLimit(usage.value))
const atLimit = computed(() => usage.value && [usage.value.drops, usage.value.bytes, usage.value.writes].some(quota => quota.limit !== null && quota.used >= quota.limit))
const storageMiB = computed(() => Math.ceil((usage.value?.bytes.used ?? 0) / MIB * 10) / 10)
watch(drops, () => refreshUsage())
const filter = ref<"all" | "private" | "shared">("all")
const search = ref("")
const searchInput = useTemplateRef("searchInput")
const picker = useFileDialog({ multiple: false, reset: true })
picker.onChange(files => files?.[0] && void onPick(files[0]))
const creating = ref(false)
const now = useRelativeNow()

const counts = computed(() => ({
  all: drops.value.length,
  private: drops.value.filter(drop => drop.visibility === "private").length,
  shared: drops.value.filter(drop => drop.visibility === "shared").length,
}))

const visible = computed(() => {
  const query = search.value.trim().toLowerCase()
  return drops.value
    .filter(drop => filter.value === "all" || drop.visibility === filter.value)
    .filter(drop => !query || `${drop.title} ${drop.filename} ${drop.actorName}`.toLowerCase().includes(query))
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
    const name = label(drop.updatedAt)
    const last = out.at(-1)
    if (last?.label === name) last.drops.push(drop)
    else out.push({ label: name, drops: [drop] })
  }
  return out
})

defineShortcuts({ "/": () => searchInput.value?.inputRef?.focus() })

async function newDrop() {
  creating.value = true
  const drop = await create()
  creating.value = false
  if (drop) await navigateTo({ path: `/drops/${drop.id}`, query: { edit: "1" } })
}

async function onPick(file: File) {
  const result = await upload(file)
  if (result) await navigateTo(`/drops/${result.id}`)
}
</script>

<template>
  <PageShell id="drops" title="Drops" description="Docs and apps you and your agents dropped. Private until you share them.">
    <template #actions>
      <UButton color="neutral" icon="i-lucide-upload" label="Upload" variant="outline" @click="picker.open()" />
      <UButton color="neutral" icon="i-lucide-plus" label="New Drop" :loading="creating" @click="newDrop" />
    </template>

    <div v-if="usage?.enabled" class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default px-4 py-3" aria-live="polite">
      <div>
        <p class="text-sm tabular-nums text-highlighted">
          {{ usage.drops.used }}/{{ usage.drops.limit ?? '∞' }} drops · {{ storageMiB }}/{{ usage.bytes.limit === null ? '∞' : usage.bytes.limit / MIB }} MiB
        </p>
        <p class="mt-1 text-xs text-muted">
          {{ usage.writes.used }}/{{ usage.writes.limit ?? '∞' }} file writes this month<template v-if="nearLimit">. {{ atLimit ? 'At your plan limit.' : 'Near your plan limit.' }}</template>
        </p>
      </div>
      <div v-if="nearLimit" class="flex flex-wrap gap-2">
        <UButton color="neutral" label="Upgrade" size="sm" :to="usage.upgradeUrl" variant="outline" />
        <UButton color="neutral" label="Deploy your own" size="sm" :to="usage.selfHostUrl" variant="outline" />
      </div>
    </div>

    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <UTabs
        v-model="filter"
        :content="false"
        :items="[
          { label: `All ${counts.all}`, value: 'all' },
          { label: `Private ${counts.private}`, value: 'private', icon: 'i-lucide-lock' },
          { label: `Shared ${counts.shared}`, value: 'shared', icon: 'i-lucide-globe' },
        ]"
        size="sm"
        color="neutral"
      />
      <UInput ref="searchInput" v-model="search" class="w-full sm:w-72" icon="i-lucide-search" placeholder="Search drops">
        <template #trailing><UKbd value="/" /></template>
      </UInput>
    </div>

    <div v-if="status === 'pending' && !drops.length" class="space-y-2">
      <USkeleton v-for="index in 4" :key="index" class="h-16 w-full" />
    </div>

    <div v-else-if="error" class="rounded-lg border border-dashed border-default px-6 py-16 text-center" role="alert">
      <UIcon name="i-lucide-circle-alert" class="size-6 text-error" />
      <p class="mt-3 font-medium text-highlighted">Couldn't load your drops</p>
      <p class="mt-1 text-sm text-muted">Try again in a moment.</p>
      <UButton class="mt-5" color="neutral" label="Try again" variant="outline" @click="refresh()" />
    </div>

    <div v-else-if="!drops.length" class="rounded-lg border border-dashed border-default px-6 py-16 text-center">
      <UIcon name="i-lucide-layers" class="size-6 text-dimmed" />
      <p class="mt-3 font-medium text-highlighted">Nothing dropped yet</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted">Connect an agent and it drops plans, specs, and small apps here. Or start one yourself.</p>
      <div class="mt-5 flex justify-center gap-2">
        <UButton color="neutral" label="Connect an Agent" to="/agents?tab=mcp" variant="outline" />
        <UButton color="neutral" label="New Drop" variant="ghost" @click="newDrop" />
      </div>
    </div>

    <p v-else-if="!visible.length" class="py-16 text-center text-sm text-muted">No drops match.</p>

    <div v-else class="overflow-hidden rounded-lg border border-default">
      <template v-for="group in groups" :key="group.label">
        <p class="label-mono border-b border-default bg-muted px-4 py-2">{{ group.label }}</p>
        <ul class="divide-y divide-default border-b border-default last:border-b-0">
          <DropRow v-for="drop in group.drops" :key="drop.id" :drop="drop" @delete="remove(drop)" />
        </ul>
      </template>
    </div>

  </PageShell>
</template>
