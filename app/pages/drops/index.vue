<script setup lang="ts">
// Your drops, newest first as cards that preview what's inside (DropCard), or as a list (DropLine). No top bar: the
// sidebar says where you are, makes new drops (its +) and searches (⌘K, whose first row brings every match here as
// `?q=`). One row leads the page: Recent or Folders, which the reader keeps (a cookie), the Trash beside them, a
// search's words while it's on, and grid or list.
//
// Clicks follow Finder and the folder page (ViewerFolder): on wide screens one click previews the drop in a pane that
// pushes the page left (ViewerFolderPreview, its width dragged from its edge), a double-click, Enter or Open opens it;
// the arrow keys walk the drops with the preview following, Escape closes it. Files dropped on the page upload.
//
// The sidebar's Shared with me (Team, on a team Drop) is `?tab=with-me`: the same cards, for what others share.
import { breakpointsTailwind } from "@vueuse/core"
import { TRASH_DAYS } from "#shared/expiry"
import type { DropSummary } from "#shared/types"

// The layout waits for your drops before this page's setup runs, which put the Trash and usage a round trip later.
// Started here, before either renders, they load alongside the sidebar's (started by the auth middleware).
definePageMeta({
  middleware: () => {
    void useDrops()
    useTrash()
    useUsage()
  },
})

useSeoMeta({ title: "Drops" })
const { data: drops, status, error, refresh } = useDrops()
const { upload, remove, restore, deleteForever, emptyTrash, createFolder, createSite } = useDropActions()
const folderDialog = useFolderDialog()
const siteDialog = useSiteDialog()
const { data: me } = useMe()
const team = computed(() => me.value?.mode === "team")
const { data: trash } = useTrash()
const { data: shared } = useSharedWithMe()
// A personal Drop's teams list their folders under Teams, not here.
const withMe = computed(() => (team.value ? shared.value : shared.value.filter((drop) => !drop.team)))
const getStartedHidden = useGetStartedHidden()

const route = useRoute("drops")
const view = useDropsView()
const layout = useDropsLayout()
// What the page shows: the Trash and Shared with me are places in the URL, Recent and Folders the reader's own view.
const place = computed(() => (route.query.tab === "trash" ? "trash" : route.query.tab === "with-me" ? "with-me" : null))
const VIEWS = [
  { value: "recent", label: "Recent", icon: "i-mingcute-time-line" },
  { value: "folders", label: "Folders", icon: "i-mingcute-folder-line" },
  { value: "trash", label: "Trash", icon: "i-mingcute-delete-2-line" },
] as const
const current = computed(() => place.value ?? view.value)
function show(value: (typeof VIEWS)[number]["value"]) {
  if (value !== "trash") view.value = value
  void navigateTo({ query: { tab: value === "trash" ? "trash" : undefined } }, { replace: true })
}

// A search from ⌘K's "Show every drop matching": your drops at any depth, by name and by a doc's words.
const query = computed(() => (typeof route.query.q === "string" ? route.query.q.trim() : ""))
const kind = computed(() => (typeof route.query.kind === "string" ? route.query.kind : ""))
const searching = computed(() => Boolean(query.value || kind.value) && !place.value)
const {
  data: found,
  status: searchStatus,
  execute: search,
} = useApi<DropSummary[]>("/api/drops", {
  key: keys.dropSearch,
  query: computed(() => ({ q: query.value || undefined, kind: kind.value || undefined })),
  default: () => [],
  immediate: searching.value,
  watch: false,
})
watch([query, kind], () => searching.value && void search())
const clearSearch = () =>
  void navigateTo({ query: { ...route.query, q: undefined, kind: undefined } }, { replace: true })
const openPalette = usePaletteOpener()
defineShortcuts({ "/": () => openPalette(query.value ? `${query.value} ` : "") })

const visible = computed(() => {
  if (place.value === "trash") return trash.value
  if (place.value === "with-me") return withMe.value
  if (searching.value) return found.value
  if (view.value === "recent") return drops.value
  return [
    ...drops.value.filter((drop) => drop.kind === "folder"),
    ...drops.value.filter((drop) => drop.kind !== "folder"),
  ]
})

// Each card costs the server render a little, so the page starts with the newest ROWS, about two screens of cards, and
// shows more as you reach its end. The search and Recent still cover every drop.
const ROWS = 24
const shown = ref(ROWS)
watch([current, query, kind], () => (shown.value = ROWS))
const more = useTemplateRef("more")
useIntersectionObserver(more, ([entry]) => {
  if (entry?.isIntersecting) shown.value += ROWS
})

/**
 * Recent groups by day: Today, Yesterday, This week, then month names. Folders puts the folders before the rest. The
 * Worker renders in UTC, so the server render and hydration group in UTC and the browser regroups in the reader's own
 * timezone once mounted.
 */
const now = useRelativeNow()
const mounted = useMounted()
const groups = computed(() => {
  const list = visible.value.slice(0, shown.value)
  if (current.value === "folders" && !searching.value) {
    const folders = list.filter((drop) => drop.kind === "folder")
    const rest = list.filter((drop) => drop.kind !== "folder")
    return [
      ...(folders.length ? [{ label: "Folders", drops: folders }] : []),
      ...(rest.length ? [{ label: "Drops", drops: rest }] : []),
    ]
  }
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
  for (const drop of list) {
    // The Trash groups by when things went there, which is also what sets when they're deleted.
    const name = label(place.value === "trash" ? (drop.trashedAt ?? drop.updatedAt) : drop.updatedAt)
    const last = out.at(-1)
    if (last?.label === name) last.drops.push(drop)
    else out.push({ label: name, drops: [drop] })
  }
  return out
})
const order = computed(() => groups.value.flatMap((group) => group.drops))

// One click picks, a double-click opens. Below `lg` there's no room for the preview, so a click opens at once, and so
// do clicks with a modifier (a new tab) everywhere, and Enter (a click with no `detail`).
const wide = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 }).greaterOrEqual("lg")
const selected = ref<string | null>(null)
const picked = computed(() => (wide.value ? order.value.find((drop) => drop.id === selected.value) : undefined))
watch(current, () => (selected.value = null))
function pick(event: MouseEvent, drop: DropSummary) {
  if (!wide.value || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || !event.detail) return
  event.preventDefault()
  if (event.detail > 1) return void navigateTo(`/drops/${drop.id}`)
  selected.value = drop.id
}
const list = useTemplateRef("list")
// Arrows walk the drops with the preview following; Escape closes it. In the grid, up and down move a row of cards.
function walk(event: KeyboardEvent) {
  if (event.key === "Escape" && selected.value) return void (selected.value = null)
  const across = layout.value === "grid" ? columns() : 1
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: across, ArrowUp: -across }[event.key]
  if (!step || !order.value.length) return
  event.preventDefault()
  const at = order.value.findIndex((drop) => drop.id === selected.value)
  const next = order.value[Math.min(order.value.length - 1, Math.max(0, at === -1 ? 0 : at + step))]!
  if (wide.value) selected.value = next.id
  list.value?.querySelector<HTMLElement>(`[data-id="${next.id}"] a`)?.focus()
}
// How many cards sit in a row: the cards of the first group that share the first one's top.
function columns() {
  const cards = [...(list.value?.querySelectorAll<HTMLElement>("ul[data-grid] > li") ?? [])]
  const top = cards[0]?.offsetTop
  return Math.max(1, cards.filter((card) => card.offsetTop === top).length)
}
async function trashOne(drop: DropSummary) {
  if ((await remove(drop)) && selected.value === drop.id) selected.value = null
}

// The preview's width, dragged from its left edge, shared with the folder page's.
const preview = useResizeHandle(useFolderPreviewWidth(), { min: 18, max: 40, initial: 22 })

// Files dropped anywhere on the page upload to the top; one opens once it's in.
const root = useTemplateRef("root")
const uploading = ref(0)
async function uploadFiles(files: File[]) {
  if (!files.length) return
  uploading.value = files.length
  let last: { id: string } | undefined
  for (const file of files) {
    last = (await upload(file)) ?? last
    uploading.value--
  }
  if (!last) return
  if (wide.value) selected.value = last.id
  else if (files.length === 1) await navigateTo(`/drops/${last.id}`)
}
const { isOverDropZone } = useDropZone(root, { multiple: true, onDrop: (files) => void uploadFiles(files ?? []) })
const dropping = computed(() => isOverDropZone.value && place.value !== "trash" && place.value !== "with-me")

// Admins on a team Drop make the team's folders; on the Team page that's what a new folder is by default.
async function newTeamFolder() {
  const input = await folderDialog({ offerTeam: true, team: true })
  if (input) await createFolder(input.title, undefined, { description: input.description, team: input.team })
}
async function newSite() {
  const input = await siteDialog()
  const site = input && (await createSite(input))
  if (site) await navigateTo(`/drops/${site.id}`)
}
const picker = useFileDialog({ multiple: true, reset: true })
picker.onChange((files) => void uploadFiles([...(files ?? [])]))
</script>

<template>
  <UDashboardPanel id="drops" :ui="{ body: 'p-0 sm:p-0 gap-0 overflow-hidden' }">
    <template #body>
      <div ref="root" class="relative flex min-h-0 flex-1">
        <div class="min-w-0 flex-1 overflow-y-auto">
          <div class="px-4 pt-4 pb-24 lg:px-8 lg:pt-6">
            <div class="mb-6 flex flex-wrap items-center gap-2">
              <SidebarExpand />
              <h1 v-if="place === 'with-me'" class="text-sm font-medium text-highlighted">
                {{ team ? "Team" : "Shared with me" }}
                <span class="ml-1 font-mono text-xs font-normal text-muted tabular-nums">{{ withMe.length }}</span>
              </h1>
              <!-- Recent and Folders are the reader's view; the Trash sits beside them, with how much it holds. -->
              <div v-else class="flex gap-0.5 rounded-lg bg-elevated p-0.5" role="radiogroup" aria-label="View">
                <button
                  v-for="item in VIEWS"
                  :key="item.value"
                  :aria-checked="current === item.value && !searching"
                  class="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)"
                  :class="
                    current === item.value && !searching
                      ? 'bg-default text-highlighted shadow-[0_0_0_1px_rgb(0_0_0/.05),0_1px_2px_rgb(0_0_0/.08)] dark:shadow-[0_0_0_1px_rgb(255_255_255/.09)]'
                      : 'text-muted hover:text-highlighted'
                  "
                  role="radio"
                  type="button"
                  @click="show(item.value)"
                >
                  <UIcon :name="item.icon" class="size-4" />
                  {{ item.label }}
                  <span
                    v-if="item.value === 'trash' && trash.length"
                    class="font-mono text-xs text-muted tabular-nums"
                    >{{ trash.length }}</span
                  >
                </button>
              </div>
              <span
                v-if="searching"
                class="flex h-8 items-center gap-1.5 rounded-lg bg-elevated pr-1 pl-2.5 text-sm text-muted"
              >
                Matching <span class="font-medium text-highlighted">“{{ query || kind }}”</span>
                <span class="font-mono text-xs tabular-nums">{{
                  searchStatus === "pending" ? "…" : found.length
                }}</span>
                <UButton
                  aria-label="Clear the search"
                  color="neutral"
                  icon="i-mingcute-close-line"
                  size="xs"
                  variant="ghost"
                  @click="clearSearch"
                />
              </span>
              <span class="flex-1" />
              <UButton
                v-if="place === 'trash' && trash.length"
                color="error"
                icon="i-mingcute-delete-2-line"
                label="Empty Trash"
                size="sm"
                variant="ghost"
                @click="emptyTrash(trash.length)"
              />
              <UButton
                v-if="place === 'with-me' && team && me?.role === 'admin'"
                color="neutral"
                icon="i-mingcute-new-folder-line"
                label="New team folder"
                size="sm"
                variant="ghost"
                @click="newTeamFolder"
              />
              <div
                v-if="place !== 'trash'"
                class="flex gap-0.5 rounded-lg bg-elevated p-0.5"
                role="radiogroup"
                aria-label="Layout"
              >
                <UTooltip
                  v-for="item in ['grid', 'list'] as const"
                  :key="item"
                  :text="item === 'grid' ? 'Cards' : 'List'"
                >
                  <button
                    :aria-checked="layout === item"
                    :aria-label="item === 'grid' ? 'Cards' : 'List'"
                    class="grid h-7 w-8 cursor-pointer place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)"
                    :class="
                      layout === item
                        ? 'bg-default text-highlighted shadow-[0_0_0_1px_rgb(0_0_0/.05),0_1px_2px_rgb(0_0_0/.08)] dark:shadow-[0_0_0_1px_rgb(255_255_255/.09)]'
                        : 'text-muted hover:text-highlighted'
                    "
                    role="radio"
                    type="button"
                    @click="layout = item"
                  >
                    <UIcon
                      :name="item === 'grid' ? 'i-mingcute-grid-line' : 'i-mingcute-list-check-line'"
                      class="size-4"
                    />
                  </button>
                </UTooltip>
              </div>
            </div>

            <p v-if="place === 'trash'" class="-mt-2 mb-6 text-sm text-muted">
              Deleted and expired drops. Restore one within {{ TRASH_DAYS }} days, or it's gone for good.
            </p>

            <!-- The cards' own boxes, so the drops land without moving anything. -->
            <ul
              v-if="status === 'pending' && !drops.length && !place"
              aria-hidden="true"
              class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-6"
            >
              <li v-for="index in 8" :key="index">
                <USkeleton class="aspect-[16/10] w-full rounded-xl" />
                <USkeleton class="mt-3 h-4 w-40 max-w-full" />
                <USkeleton class="mt-1.5 h-3 w-28 max-w-full" />
              </li>
            </ul>

            <div
              v-else-if="error"
              class="rounded-lg border border-dashed border-default px-6 py-16 text-center"
              role="alert"
            >
              <UIcon name="i-mingcute-warning-line" class="size-6 text-error" />
              <p class="mt-3 font-medium text-highlighted">Couldn't load your drops</p>
              <p class="mt-1 text-sm text-muted">Try again in a moment.</p>
              <UButton class="mt-5" color="neutral" label="Try again" variant="outline" @click="refresh()" />
            </div>

            <div
              v-else-if="place === 'trash' && !trash.length"
              class="rounded-lg border border-dashed border-default px-6 py-16 text-center"
            >
              <UIcon name="i-mingcute-delete-2-line" class="size-6 text-dimmed" />
              <p class="mt-3 font-medium text-highlighted">The Trash is empty</p>
              <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
                Deleted and expired drops stay here for {{ TRASH_DAYS }} days, then they're gone for good.
              </p>
            </div>

            <div
              v-else-if="place === 'with-me' && !withMe.length"
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
            </div>

            <!-- A first run gets the checklist instead; once it's dismissed, the empty page still says what goes here. -->
            <GetStarted
              v-else-if="!place && !searching && !drops.length && !getStartedHidden"
              :drops="drops"
              @site="newSite"
              @upload="picker.open()"
            />

            <div
              v-else-if="!place && !searching && !drops.length"
              class="rounded-lg border border-dashed border-default px-6 py-16 text-center"
            >
              <UIcon name="i-mingcute-layers-line" class="size-6 text-dimmed" />
              <p class="mt-3 font-medium text-highlighted">Nothing dropped yet</p>
              <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
                Connect an agent and it drops plans, specs, and small apps here. You can drop a file on this page too.
              </p>
              <div class="mt-5 flex justify-center gap-2">
                <UButton color="neutral" label="Connect an agent" to="/agents" />
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
              {{ searching && searchStatus === "pending" ? "Searching…" : "No drops match." }}
            </p>

            <GetStarted
              v-if="!place && !searching && drops.length"
              :drops="drops"
              @site="newSite"
              @upload="picker.open()"
            />

            <div v-if="visible.length" ref="list" @keydown="walk">
              <section v-for="group in groups" :key="group.label" class="mb-8">
                <h2 class="label-mono mb-3">{{ group.label }}</h2>
                <!-- The Trash keeps its rows: Restore and Delete for good are what it's for. -->
                <ul
                  v-if="place === 'trash'"
                  class="divide-y divide-default overflow-hidden rounded-lg border border-default"
                >
                  <DropRow
                    v-for="drop in group.drops"
                    :key="drop.id"
                    :drop="drop"
                    @delete="remove(drop)"
                    @delete-forever="deleteForever(drop)"
                    @restore="restore(drop)"
                  />
                </ul>
                <ul
                  v-else-if="layout === 'grid'"
                  class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-6"
                  data-grid
                >
                  <DropCard
                    v-for="drop in group.drops"
                    :key="drop.id"
                    :drop="drop"
                    :in-team="place === 'with-me' && team"
                    :selected="picked?.id === drop.id"
                    @delete="trashOne(drop)"
                    @pick="pick($event, drop)"
                  />
                </ul>
                <ul v-else>
                  <DropLine
                    v-for="drop in group.drops"
                    :key="drop.id"
                    :drop="drop"
                    :in-team="place === 'with-me' && team"
                    :selected="picked?.id === drop.id"
                    @delete="trashOne(drop)"
                    @pick="pick($event, drop)"
                  />
                </ul>
              </section>
            </div>
            <div v-if="visible.length > shown" ref="more" class="flex justify-center">
              <UButton
                color="neutral"
                :label="`Show ${Math.min(ROWS, visible.length - shown)} more`"
                variant="ghost"
                @click="shown += ROWS"
              />
            </div>
          </div>
        </div>

        <template v-if="picked">
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
              :title="picked.title"
              :to="`/drops/${picked.id}`"
              @close="selected = null"
            />
          </aside>
        </template>

        <!-- Files dragged over the page: one target for all of it. -->
        <div
          v-if="dropping || uploading"
          class="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-lg border-2 border-dashed border-inverted bg-default/85"
        >
          <p class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <UIcon name="i-mingcute-upload-2-line" class="size-4" />
            {{ uploading ? `Uploading ${uploading}…` : "Drop to upload" }}
          </p>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
