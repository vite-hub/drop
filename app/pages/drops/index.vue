<script setup lang="ts">
import { TRASH_DAYS } from "#shared/expiry"
import { MIB, usageNearLimit } from "#shared/quotas"
import type { DropSummary } from "#shared/types"

useSeoMeta({ title: "Drops" })

const { data: drops, status, error, refresh } = useDrops()
const { upload, remove, restore, deleteForever, emptyTrash, createFolder, createSite, createDoc, createBoard } =
  useDropActions()
const folderDialog = useFolderDialog()
const siteDialog = useSiteDialog()
const { data: me } = useMe()
const team = computed(() => me.value?.mode === "team")
const open = useRowsOpen()
const { data: trash } = useApi("/api/drops", { key: keys.trash, query: { trash: 1 }, default: () => [] })
const { data: withMe } = useSharedWithMe()
const { data: usage } = useApi("/api/usage", { key: keys.usage })
const limited = computed(
  () =>
    usage.value?.enabled &&
    [usage.value.drops, usage.value.bytes, usage.value.writes].some((quota) => quota.limit !== null),
)
const nearLimit = computed(() => usage.value && usageNearLimit(usage.value))
const atLimit = computed(
  () =>
    usage.value &&
    [usage.value.drops, usage.value.bytes, usage.value.writes].some(
      (quota) => quota.limit !== null && quota.used >= quota.limit,
    ),
)
const storageMiB = computed(() => Math.ceil(((usage.value?.bytes.used ?? 0) / MIB) * 10) / 10)
const FILTERS = ["all", "private", "shared", "with-me", "trash"] as const
type Filter = (typeof FILTERS)[number]
// The tab lives in the URL so the sidebar can link straight to Shared with me.
const route = useRoute("drops")
const filter = computed<Filter>({
  get: () => FILTERS.find((tab) => tab === route.query.tab) ?? "all",
  set: (tab) => void navigateTo({ query: { ...route.query, tab: tab === "all" ? undefined : tab } }, { replace: true }),
})
const search = ref("")
const searchInput = useTemplateRef("searchInput")
const picker = useFileDialog({ multiple: false, reset: true })
picker.onChange((files) => files?.[0] && void onPick(files[0]))
const now = useRelativeNow()
const getStartedHidden = useGetStartedHidden()

// The header says what the tab lists: Team, Shared with me and the Trash aren't drops you made. On a team Drop the
// "with-me" tab is the team's: its folders and what teammates share.
const description = computed(() => {
  if (filter.value === "trash")
    return `Deleted and expired drops. Restore one within ${TRASH_DAYS} days, or it's gone for good.`
  if (filter.value === "with-me")
    return team.value
      ? "The team's folders, and what your teammates and their agents dropped for the team."
      : "Public links others shared that you opened while signed in."
  return team.value
    ? "Docs and apps you and your agents dropped. The team sees them, unless you keep one to yourself."
    : "Docs and apps you and your agents dropped. Only you see them until you share them."
})

const counts = computed(() => ({
  all: drops.value.length,
  private: drops.value.filter((drop) => drop.share === "private").length,
  shared: drops.value.filter((drop) => drop.share !== "private").length,
  withMe: withMe.value.length,
  trash: trash.value.length,
}))

// Your own drops search on the server, inside every folder; the Trash and Shared with me filter what they list.
const query = refDebounced(
  computed(() => search.value.trim()),
  200,
)
const deep = computed(() => Boolean(query.value) && filter.value !== "trash" && filter.value !== "with-me")
const { data: found, status: searching } = useApi<DropSummary[]>("/api/drops", {
  key: keys.dropSearch,
  query: computed(() => ({ q: query.value })),
  default: () => [],
  immediate: false,
  server: false,
})

const visible = computed(() => {
  const words = search.value.trim().toLowerCase()
  const list = deep.value
    ? found.value
    : filter.value === "trash"
      ? trash.value
      : filter.value === "with-me"
        ? withMe.value
        : drops.value
  return list
    .filter((drop) => filter.value !== "private" || drop.share === "private")
    .filter((drop) => filter.value !== "shared" || drop.share !== "private")
    .filter(
      (drop) =>
        deep.value ||
        !words ||
        `${drop.title} ${drop.filename} ${drop.actorName} ${drop.owner?.name ?? ""}`.toLowerCase().includes(words),
    )
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
    const name = label(filter.value === "trash" ? (drop.trashedAt ?? drop.updatedAt) : drop.updatedAt)
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

// Admins on a team Drop make the team's folders; on the Team tab that's what a new folder is by default.
async function newFolder() {
  const offerTeam = team.value && me.value?.role === "admin"
  const input = await folderDialog({ offerTeam, team: offerTeam && filter.value === "with-me" })
  if (!input) return
  const folder = await createFolder(input.title, undefined, { description: input.description, team: input.team })
  if (folder?.teamFolder && filter.value !== "with-me") filter.value = "with-me"
}

// A new doc opens in the editor, ready to write in.
async function newDoc() {
  const doc = await createDoc()
  if (doc) await navigateTo(`/drops/${doc.id}?edit=1`)
}

async function newBoard() {
  const board = await createBoard()
  if (board) await navigateTo(`/drops/${board.id}`)
}

async function newSite() {
  const input = await siteDialog()
  const site = input && (await createSite(input))
  if (site) await navigateTo(`/drops/${site.id}`)
}
</script>

<template>
  <PageShell id="drops" title="Drops" :description="description">
    <template #actions>
      <NewMenu @board="newBoard" @doc="newDoc" @folder="newFolder" @site="newSite" />
      <UButton
        color="neutral"
        icon="i-mingcute-upload-2-line"
        label="Upload"
        size="sm"
        variant="outline"
        @click="picker.open()"
      />
    </template>

    <div
      v-if="usage && limited"
      class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default px-4 py-3"
      aria-live="polite"
    >
      <div>
        <p class="text-sm tabular-nums text-highlighted">
          {{ usage.drops.used }}/{{ usage.drops.limit ?? "∞" }} drops · {{ storageMiB }}/{{
            usage.bytes.limit === null ? "∞" : usage.bytes.limit / MIB
          }}
          MiB
        </p>
        <p class="mt-1 text-xs text-muted">
          {{ usage.writes.used }}/{{ usage.writes.limit ?? "∞" }} file writes this month<template v-if="nearLimit"
            >. {{ atLimit ? "At your plan limit." : "Near your plan limit." }}</template
          >
        </p>
      </div>
      <div v-if="nearLimit" class="flex flex-wrap gap-2">
        <UButton color="neutral" label="Deploy your own" size="sm" :to="usage.selfHostUrl" variant="outline" />
      </div>
    </div>

    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <!-- The five tabs are wider than a phone: they scroll sideways instead of hiding the Trash off-screen. -->
      <div class="-mx-1 max-w-full overflow-x-auto px-1">
        <UTabs
          v-model="filter"
          :content="false"
          :items="[
            { label: `All ${counts.all}`, value: 'all' },
            { label: `Only me ${counts.private}`, value: 'private', icon: 'i-mingcute-lock-line' },
            { label: `Shared ${counts.shared}`, value: 'shared', icon: 'i-mingcute-share-2-line' },
            team
              ? { label: `Team ${counts.withMe}`, value: 'with-me', icon: 'i-mingcute-group-2-line' }
              : { label: `Shared with me ${counts.withMe}`, value: 'with-me', icon: 'i-mingcute-inbox-line' },
            { label: `Trash ${counts.trash}`, value: 'trash', icon: 'i-mingcute-delete-2-line' },
          ]"
          size="sm"
          color="neutral"
          :ui="{ root: 'w-max' }"
        />
      </div>
      <div class="flex w-full items-center gap-2 sm:w-auto">
        <!-- The page description already says how long the Trash keeps things. -->
        <UButton
          v-if="filter === 'trash' && trash.length"
          class="shrink-0"
          color="error"
          icon="i-mingcute-delete-2-line"
          label="Empty Trash"
          variant="ghost"
          @click="emptyTrash(trash.length)"
        />
        <UInput
          ref="searchInput"
          v-model="search"
          class="w-full sm:w-72"
          icon="i-mingcute-search-line"
          placeholder="Search drops"
        >
          <template #trailing><UKbd value="/" /></template>
        </UInput>
      </div>
    </div>

    <div v-if="status === 'pending' && !drops.length" class="space-y-2">
      <USkeleton v-for="index in 4" :key="index" class="h-16 w-full" />
    </div>

    <div v-else-if="error" class="rounded-lg border border-dashed border-default px-6 py-16 text-center" role="alert">
      <UIcon name="i-mingcute-warning-line" class="size-6 text-error" />
      <p class="mt-3 font-medium text-highlighted">Couldn't load your drops</p>
      <p class="mt-1 text-sm text-muted">Try again in a moment.</p>
      <UButton class="mt-5" color="neutral" label="Try again" variant="outline" @click="refresh()" />
    </div>

    <div
      v-else-if="filter === 'trash' && !trash.length"
      class="rounded-lg border border-dashed border-default px-6 py-16 text-center"
    >
      <UIcon name="i-mingcute-delete-2-line" class="size-6 text-dimmed" />
      <p class="mt-3 font-medium text-highlighted">The Trash is empty</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
        Deleted and expired drops stay here for {{ TRASH_DAYS }} days, then they're gone for good.
      </p>
    </div>

    <div
      v-else-if="filter === 'with-me' && !withMe.length"
      class="rounded-lg border border-dashed border-default px-6 py-16 text-center"
    >
      <UIcon :name="team ? 'i-mingcute-group-2-line' : 'i-mingcute-inbox-line'" class="size-6 text-dimmed" />
      <p class="mt-3 font-medium text-highlighted">
        {{ team ? "No team folders yet" : "Nothing shared with you yet" }}
      </p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
        {{
          team
            ? me?.role === "admin"
              ? "Make a folder for each kind of thing the team keeps, like meeting notes or pull request evidence, and say what goes in it. Agents read that to file things there."
              : "Admins make the team's folders. What your teammates drop for the team shows up here too."
            : "Public links you open while signed in show up here."
        }}
      </p>
      <UButton
        v-if="team && me?.role === 'admin'"
        class="mt-5"
        color="neutral"
        icon="i-mingcute-new-folder-line"
        label="New team folder"
        @click="newFolder"
      />
    </div>

    <!-- A first run gets the checklist instead; once it's dismissed, the empty page still says what goes here. -->
    <GetStarted
      v-else-if="filter === 'all' && !drops.length && !getStartedHidden"
      :drops="drops"
      @site="newSite"
      @upload="picker.open()"
    />

    <div
      v-else-if="filter !== 'trash' && filter !== 'with-me' && !drops.length"
      class="rounded-lg border border-dashed border-default px-6 py-16 text-center"
    >
      <UIcon name="i-mingcute-layers-line" class="size-6 text-dimmed" />
      <p class="mt-3 font-medium text-highlighted">Nothing dropped yet</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
        Connect an agent and it drops plans, specs, and small apps here. You can upload a file yourself too.
      </p>
      <div class="mt-5 flex justify-center gap-2">
        <UButton color="neutral" label="Connect an Agent" to="/agents" />
        <UButton
          color="neutral"
          icon="i-mingcute-upload-2-line"
          label="Upload"
          variant="outline"
          @click="picker.open()"
        />
      </div>
    </div>

    <p v-else-if="!visible.length" class="py-16 text-center text-sm text-muted">
      {{ deep && searching === "pending" ? "Searching…" : "No drops match." }}
    </p>

    <GetStarted
      v-if="filter === 'all' && drops.length && !search"
      :drops="drops"
      @site="newSite"
      @upload="picker.open()"
    />

    <div v-if="visible.length" class="overflow-hidden rounded-lg border border-default">
      <template v-for="group in groups" :key="group.label">
        <p class="label-mono border-b border-default bg-muted px-4 py-2">{{ group.label }}</p>
        <ul class="divide-y divide-default border-b border-default last:border-b-0">
          <template v-for="drop in group.drops" :key="drop.id">
            <DropRow
              :drop="drop"
              :open="open[drop.id]"
              @delete="remove(drop)"
              @restore="restore(drop)"
              @delete-forever="deleteForever(drop)"
              @toggle="open[drop.id] = !open[drop.id]"
            />
            <!-- A folder opens in place, except in the Trash, where it comes back whole (DropRow shows no toggle there). -->
            <DropFolderRows
              v-if="drop.kind === 'folder' && open[drop.id] && !drop.trashedAt"
              :id="drop.id"
              :depth="1"
              :team="drop.teamFolder"
            />
          </template>
        </ul>
      </template>
    </div>
  </PageShell>
</template>
