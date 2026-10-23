<script setup lang="ts">
// The ⌘K palette on every dashboard page: drops you can open (yours at any depth, then teammates'), matched by name or
// by a doc's words on the server, and, matched here, what you can do with the drop open, new drops to make, the app's
// pages, the theme, and signing out. The sidebar's search button opens it too.
import type { CommandPaletteGroup, CommandPaletteItem } from "@nuxt/ui"
import type { DropSummary } from "#shared/types"

const { data: me } = useMe()
const shortcutsOpen = useShortcutsOpen()
const signOut = useSignOut()
const { createDoc, createBoard, createFolder, createSite, upload } = useDropActions()
const folderDialog = useFolderDialog()
const siteDialog = useSiteDialog()
// The drop and the folder open on the page (offerToPalette): its commands, and where new drops go.
const context = injectPaletteContext()
const current = computed(() => context?.drop.value ?? null)
const folder = computed(() => context?.folder.value ?? null)
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

// Plain links: the three /drops tabs would all read as the current page otherwise. A team Drop's Team page takes the
// place of Shared with me, as in the sidebar.
const pages = computed<CommandPaletteItem[]>(() =>
  [
    { label: me.value?.mode === "team" ? "My drops" : "Drops", icon: "i-mingcute-layers-line", to: "/drops" },
    me.value?.mode === "team"
      ? { label: "Team", icon: "i-mingcute-group-2-line", to: "/drops?tab=with-me" }
      : { label: "Shared with me", icon: "i-mingcute-inbox-line", to: "/drops?tab=with-me" },
    { label: "Trash", icon: "i-mingcute-delete-2-line", to: "/drops?tab=trash" },
    { label: "Agents", icon: "i-mingcute-sparkles-line", to: "/agents" },
    // As in the sidebar: members see Skills while one is on, and Members is the admins' page.
    ...(me.value?.role === "admin" || me.value?.skills
      ? [{ label: "Skills", icon: "i-mingcute-plugin-2-line", to: "/skills" }]
      : []),
    {
      label: "Keyboard shortcuts",
      icon: "i-mingcute-keyboard-line",
      kbds: ["?"],
      onSelect: () => (shortcutsOpen.value = true),
    },
    ...(me.value?.role === "admin"
      ? [
          { label: "Members", icon: "i-mingcute-group-2-line", to: "/members" },
          { label: "Review shares", icon: "i-mingcute-safety-certificate-line", to: "/admin/review" },
          { label: "Reports", icon: "i-mingcute-flag-1-line", to: "/admin/reports" },
        ]
      : []),
  ].map((page) => ({ ...page, active: false })),
)
// Groups of their own: Nuxt UI shows at most 12 items in a group.
const docs = DOCS_PAGES.map((page) => ({
  label: page.label,
  suffix: "Docs",
  icon: "i-mingcute-book-6-line",
  to: page.to,
  active: false,
}))
const account: CommandPaletteItem[] = [
  { label: "Sign out", icon: "i-mingcute-exit-line", onSelect: () => void signOut() },
]

const picker = useFileDialog({ multiple: false, reset: true })
picker.onChange((files) => void uploadPicked(files))
async function uploadPicked(files: FileList | null) {
  const result = files?.[0] && (await upload(files[0], folder.value ?? undefined))
  if (result) await navigateTo(`/drops/${result.id}`)
}

// The New menu's drops and Upload. In a folder you add to they go in it, as its New menu would put them; a team
// folder's members add drops but not folders, so their new folder goes at the top. Descriptions are searched too, so
// "canvas" finds the board.
const create = computed<CommandPaletteItem[]>(() => {
  const inside = folder.value ?? undefined
  const suffix = inside && `in ${inside.title}`
  const folderInside = inside?.folders ? inside : undefined
  return [
    {
      label: "New doc",
      suffix,
      description: "A Markdown doc, opened in the editor",
      icon: KIND_ICONS.markdown,
      onSelect: async () => {
        const doc = await createDoc(inside)
        if (doc) await navigateTo(`/drops/${doc.id}?edit=1`)
      },
    },
    {
      label: "New board",
      suffix,
      description: "A whiteboard canvas to draw on together",
      icon: KIND_ICONS.board,
      onSelect: async () => {
        const board = await createBoard(inside)
        if (board) await navigateTo(`/drops/${board.id}`)
      },
    },
    {
      label: "New folder",
      suffix: folderInside && `in ${folderInside.title}`,
      description: "Groups related drops",
      icon: KIND_ICONS.folder,
      onSelect: async () => {
        const offerTeam = !folderInside && me.value?.mode === "team" && me.value.role === "admin"
        const input = await folderDialog(folderInside ? { inside: folderInside.title } : { offerTeam })
        const made =
          input && (await createFolder(input.title, folderInside, { description: input.description, team: input.team }))
        if (made) await navigateTo(`/drops/${made.id}`)
      },
    },
    {
      label: "New site review",
      suffix,
      description: "Comments on a live URL",
      icon: KIND_ICONS.site,
      onSelect: async () => {
        const input = await siteDialog()
        const site = input && (await createSite(input, inside))
        if (site) await navigateTo(`/drops/${site.id}`)
      },
    },
    {
      label: "Upload a file",
      suffix,
      description: "A doc, page, image, video, or any file",
      icon: "i-mingcute-upload-2-line",
      // Opens the file picker straight from the pick, while the browser still counts it as the person's click.
      onSelect: () => picker.open(),
    },
  ]
})

// Until the debounced words reach the server, the last results would answer the new words: show none instead.
const settled = computed(() => query.value === term.value.trim())
// The open drop's commands lead: they're about what's on screen. With words, matching pages and new drops follow: there
// are few, and most searches match none. Without, your latest drops, then what you can make. Nuxt UI adds the theme last.
const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
  ...(current.value?.items.length ? [{ id: "drop", label: current.value.title, items: current.value.items }] : []),
  ...(term.value.trim()
    ? [
        { id: "pages", label: "Go to", items: pages.value },
        { id: "create", label: "Create", items: create.value },
        { id: "docs", label: "Docs", items: docs },
        { id: "account", label: "Account", items: account },
        { id: "drops", label: "Drops", ignoreFilter: true, items: settled.value ? found.value.map(toItem) : [] },
      ]
    : [
        { id: "recent", label: "Recent", ignoreFilter: true, items: recent.value.slice(0, 5).map(toItem) },
        { id: "create", label: "Create", items: create.value },
        { id: "pages", label: "Go to", items: pages.value },
        { id: "docs", label: "Docs", items: docs },
        { id: "account", label: "Account", items: account },
      ]),
])
</script>

<template>
  <UDashboardSearch
    v-model:search-term="term"
    description="Search your drops, drops shared with you, and pages, act on the drop open, or make a new drop."
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
