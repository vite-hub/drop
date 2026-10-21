<script setup lang="ts">
// The ⌘K palette on every dashboard page: drops you can open (yours at any depth, then teammates'), matched by name or
// by a doc's words on the server, the app's pages, and new drops to make, matched here. The sidebar's search button
// opens it too.
import type { CommandPaletteGroup, CommandPaletteItem } from "@nuxt/ui"
import type { DropSummary } from "#shared/types"

const { data: me } = useMe()
const shortcutsOpen = useShortcutsOpen()
const { createDoc, createBoard, createFolder, createSite } = useDropActions()
const folderDialog = useFolderDialog()
const siteDialog = useSiteDialog()
const { data: recent } = useDrops()
const term = ref("")
const query = refDebounced(
  computed(() => term.value.trim()),
  150,
)
const { data: found, status } = useApi<DropSummary[]>("/api/search", {
  key: keys.search,
  query: computed(() => ({ q: query.value })),
  default: () => [],
  immediate: false,
  server: false,
})

/** Where a drop lives: whose it is when it isn't yours, then its folders. */
function where(drop: DropSummary) {
  const folders = drop.path?.map((crumb) => crumb.title).join(" / ")
  return [drop.owner?.name, folders && `in ${folders}`].filter(Boolean).join(" · ") || undefined
}
const toItem = (drop: DropSummary): CommandPaletteItem => ({
  id: drop.id,
  label: drop.title,
  suffix: where(drop),
  description: drop.snippet,
  icon: KIND_ICONS[drop.kind],
  to: `/drops/${drop.id}`,
})

// Plain links: the three /drops tabs would all read as the current page otherwise.
const pages = computed<CommandPaletteItem[]>(() =>
  [
    { label: "Drops", icon: "i-mingcute-layers-line", to: "/drops" },
    { label: "Shared with me", icon: "i-mingcute-inbox-line", to: "/drops?tab=with-me" },
    { label: "Trash", icon: "i-mingcute-delete-2-line", to: "/drops?tab=trash" },
    { label: "Agents", icon: "i-mingcute-sparkles-line", to: "/agents" },
    { label: "Skills", icon: "i-mingcute-plugin-2-line", to: "/skills" },
    { label: "Members", icon: "i-mingcute-group-2-line", to: "/members" },
    {
      label: "Keyboard shortcuts",
      icon: "i-mingcute-keyboard-line",
      kbds: ["?"],
      onSelect: () => (shortcutsOpen.value = true),
    },
    ...(me.value?.role === "admin"
      ? [
          { label: "Review shares", icon: "i-mingcute-safety-certificate-line", to: "/admin/review" },
          { label: "Reports", icon: "i-mingcute-flag-1-line", to: "/admin/reports" },
        ]
      : []),
    ...DOCS_PAGES.map((page) => ({ label: page.label, suffix: "Docs", icon: "i-mingcute-book-6-line", to: page.to })),
  ].map((page) => ({ ...page, active: false })),
)

// The New menu's drops, made at the top of Drops; descriptions are searched too, so "canvas" finds the board.
const create: CommandPaletteItem[] = [
  {
    label: "New doc",
    description: "A Markdown doc, opened in the editor",
    icon: KIND_ICONS.markdown,
    onSelect: async () => {
      const doc = await createDoc()
      if (doc) await navigateTo(`/drops/${doc.id}?edit=1`)
    },
  },
  {
    label: "New board",
    description: "A whiteboard canvas to draw on together",
    icon: KIND_ICONS.board,
    onSelect: async () => {
      const board = await createBoard()
      if (board) await navigateTo(`/drops/${board.id}`)
    },
  },
  {
    label: "New folder",
    description: "Groups related drops",
    icon: KIND_ICONS.folder,
    onSelect: async () => {
      const offerTeam = me.value?.mode === "team" && me.value.role === "admin"
      const input = await folderDialog({ offerTeam })
      const folder =
        input && (await createFolder(input.title, undefined, { description: input.description, team: input.team }))
      if (folder) await navigateTo(`/drops/${folder.id}`)
    },
  },
  {
    label: "New site review",
    description: "Comments on a live URL",
    icon: KIND_ICONS.site,
    onSelect: async () => {
      const input = await siteDialog()
      const site = input && (await createSite(input))
      if (site) await navigateTo(`/drops/${site.id}`)
    },
  },
]

// Until the debounced words reach the server, the last results would answer the new words: show none instead.
const settled = computed(() => query.value === term.value.trim())
// With words, matching pages and new drops go first: there are few, and most searches match none. Without, your latest
// drops, then what you can make.
const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() =>
  term.value.trim()
    ? [
        { id: "pages", label: "Go to", items: pages.value },
        { id: "create", label: "Create", items: create },
        { id: "drops", label: "Drops", ignoreFilter: true, items: settled.value ? found.value.map(toItem) : [] },
      ]
    : [
        { id: "recent", label: "Recent", ignoreFilter: true, items: recent.value.slice(0, 5).map(toItem) },
        { id: "create", label: "Create", items: create },
        { id: "pages", label: "Go to", items: pages.value },
      ],
)
</script>

<template>
  <UDashboardSearch
    v-model:search-term="term"
    :color-mode="false"
    description="Search your drops, drops shared with you, and pages, or make a new drop."
    :groups="groups"
    :loading="status === 'pending' || !settled"
    placeholder="Search drops, docs and pages, or make one"
    title="Search"
    :ui="{ itemDescription: 'line-clamp-2 whitespace-normal', itemLabelSuffix: 'truncate' }"
  >
    <template #empty>
      <p class="py-6 text-center text-sm text-muted">
        {{ status === "pending" || !settled ? "Searching…" : "Nothing matches." }}
      </p>
    </template>
  </UDashboardSearch>
</template>
