<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from "@nuxt/ui"
import { DROP_KINDS, type DropSummary } from "#shared/types"

const { data: me } = useMe()
const consoleAuth = consoleUrl("/auth")
const shortcutsOpen = useShortcutsOpen()
const signOut = useSignOut()
const { createDoc, createBoard, createFolder, newSite, upload } = useDropActions()
const folderDialog = useFolderDialog()
const context = injectPaletteContext()
const current = computed(() => context?.drop.value ?? null)
const folder = computed(() => context?.folder.value ?? null)
const scope = computed(() => context?.scope.value ?? null)
const { drops: newest } = useSidebarDrops()
const { data: pinned } = usePinned()
const pinnedIds = computed(() => new Set(pinned.value.map((drop) => drop.id)))
const recent = computed(() => newest.value.filter((drop) => !pinnedIds.value.has(drop.id)))
const dropsView = useDropsView()
const term = usePaletteTerm()
const open = ref(false)
function moveCaretToEnd() {
  if (!import.meta.client) return
  const input = document.querySelector<HTMLInputElement>("[role=dialog] input")
  input?.setSelectionRange(input.value.length, input.value.length)
}
const caretToEnd = useRafFn(moveCaretToEnd, { once: true, immediate: false })
watch(
  open,
  (opened) => {
    if (opened && term.value) caretToEnd.resume()
  },
  { flush: "post" },
)
const parsed = computed(() => parseSearch(term.value))
const filtered = computed(() => Boolean(parsed.value.folder || parsed.value.kinds.length))

const named = computed(() => parsed.value.folder?.toLowerCase())
const matches = (drop: Pick<DropSummary, "id" | "title">) =>
  drop.id === parsed.value.folder || drop.title.toLowerCase() === named.value
const others = computed(() => Boolean(named.value) && !(scope.value && matches(scope.value)))
const { data: allFolders, execute: loadFolders } = useApi<DropSummary[]>("/api/drops", {
  key: keys.folders,
  query: { folders: 1 },
  default: () => [],
  immediate: false,
  server: false,
})
watch(others, (needed) => needed && !allFolders.value.length && void loadFolders())
const searched = computed(() => {
  if (!named.value) return undefined
  const pool = [...(scope.value ? [scope.value] : []), ...allFolders.value]
  const starting = pool.filter((drop) => drop.title.toLowerCase().startsWith(named.value!))
  return pool.find(matches) ?? (new Set(starting.map((drop) => drop.id)).size === 1 ? starting[0] : undefined)
})

const request = computed(() => ({
  url: searched.value ? "/api/drops" : "/api/search",
  query: {
    q: parsed.value.words,
    ...(parsed.value.kinds.length ? { kind: parsed.value.kinds.join(",") } : {}),
    ...(searched.value ? { folder: searched.value.id } : {}),
  },
}))
const asked = refDebounced(request, 150)
const { data: found, status } = useApi<DropSummary[]>(() => asked.value.url, {
  key: keys.search,
  query: computed(() => asked.value.query),
  default: () => [],
  immediate: false,
  server: false,
})

function where(drop: DropSummary) {
  const folders = drop.path?.map((crumb) => crumb.title).join(" / ")
  return [drop.owner?.name, folders && `in ${folders}`].filter(Boolean).join(" · ") || undefined
}
const kinds = DROP_KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind] }))
const pending = computed(() => status.value === "pending" || !settled.value)
const chip = (on: boolean) => [
  "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset transition-colors outline-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)",
  on ? "bg-inverted text-inverted ring-inverted" : "text-muted ring-default hover:bg-elevated hover:text-highlighted",
]

const toItem = (drop: DropSummary): CommandPaletteItem => ({
  id: drop.id,
  label: drop.title,
  suffix: where(drop),
  description: drop.snippet,
  icon: KIND_ICONS[drop.kind],
  to: `/drops/${drop.id}`,
})

const pages = computed<CommandPaletteItem[]>(() =>
  [
    { label: me.value?.mode === "team" ? "My drops" : "Drops", icon: "i-mingcute-layers-line", to: "/drops" },
    {
      label: "Pinned",
      icon: "i-mingcute-pin-line",
      onSelect: () => {
        dropsView.value = "pinned"
        void navigateTo("/drops")
      },
    },
    me.value?.mode === "team"
      ? { label: "Team", icon: "i-mingcute-group-2-line", to: "/drops?tab=with-me" }
      : { label: "Shared with me", icon: "i-mingcute-inbox-line", to: "/drops?tab=with-me" },
    { label: "Trash", icon: "i-mingcute-delete-2-line", to: "/drops?tab=trash" },
    { label: "Agents", icon: "i-mingcute-sparkles-line", to: "/agents" },
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
          { label: "Console", icon: "i-mingcute-settings-3-line", to: consoleAuth, target: "_blank" },
          { label: "Review shares", icon: "i-mingcute-safety-certificate-line", to: "/admin/review" },
          { label: "Reports", icon: "i-mingcute-flag-1-line", to: "/admin/reports" },
        ]
      : []),
  ].map((page) => ({ ...page, active: false })),
)
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

const colorMode = useColorMode()
const appConfig = useAppConfig()
const theme = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() =>
  colorMode.forced
    ? []
    : [
        {
          id: "theme",
          label: "Theme",
          items: (["system", "light", "dark"] as const).map((mode) => ({
            id: `theme-${mode}`,
            label: mode.charAt(0).toUpperCase() + mode.slice(1),
            icon: appConfig.ui.icons[mode],
            active: colorMode.preference === mode,
            onSelect: () => (colorMode.preference = mode),
          })),
        },
      ],
)

const picker = useFileDialog({ multiple: false, reset: true })
picker.onChange((files) => void uploadPicked(files))
async function uploadPicked(files: FileList | null) {
  const result = files?.[0] && (await upload(files[0], folder.value ?? undefined))
  if (result) await navigateTo(`/drops/${result.id}`)
}

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
      onSelect: () => newSite(inside),
    },
    {
      label: "Upload a file",
      suffix,
      description: "A doc, page, image, video, or any file",
      icon: "i-mingcute-upload-2-line",
      onSelect: () => picker.open(),
    },
  ]
})

const showAll = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  const { words, kinds: picked } = parsed.value
  if (named.value || !(words || picked.length)) return []
  const query = { q: words || undefined, kind: picked.length ? picked.join(",") : undefined }
  const label = words
    ? `Show every drop matching “${words}”`
    : `Show every ${picked.map((kind) => KIND_LABELS[kind]).join(", ")}`
  return [
    {
      id: "show-all",
      ignoreFilter: true,
      items: [
        {
          id: "show-all",
          label,
          icon: "i-mingcute-search-line",
          suffix: "on the Drops page",
          to: { path: "/drops", query },
        },
      ],
    },
  ]
})

const settled = computed(() => JSON.stringify(asked.value) === JSON.stringify(request.value))
const unknownFolder = computed(() => Boolean(named.value) && !searched.value)
const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
  ...showAll.value,
  ...(filtered.value
    ? [
        {
          id: "drops",
          label: searched.value ? `In ${searched.value.title}` : "Drops",
          ignoreFilter: true,
          items: settled.value && status.value === "success" && !unknownFolder.value ? found.value.map(toItem) : [],
        },
      ]
    : []),
  ...(filtered.value
    ? []
    : (current.value?.groups ?? [])
        .filter((group) => group.items.length)
        .map((group) => ({ id: `drop-${group.id}`, label: group.label, items: group.items }))),
  ...(filtered.value
    ? []
    : term.value.trim()
      ? [
          { id: "pages", label: "Go to", items: pages.value },
          { id: "create", label: "Create", items: create.value },
          { id: "docs", label: "Docs", items: docs },
          { id: "account", label: "Account", items: account },
          ...theme.value,
          {
            id: "drops",
            label: "Drops",
            ignoreFilter: true,
            items: settled.value && status.value === "success" ? found.value.map(toItem) : [],
          },
        ]
      : [
          ...(pinned.value.length
            ? [{ id: "pinned", label: "Pinned", ignoreFilter: true, items: pinned.value.slice(0, 8).map(toItem) }]
            : []),
          { id: "recent", label: "Recent", ignoreFilter: true, items: recent.value.slice(0, 5).map(toItem) },
          { id: "create", label: "Create", items: create.value },
          { id: "pages", label: "Go to", items: pages.value },
          { id: "docs", label: "Docs", items: docs },
          { id: "account", label: "Account", items: account },
          ...theme.value,
        ]),
])
</script>

<template>
  <UDashboardSearch
    v-model:open="open"
    v-model:search-term="term"
    description="Search your drops, drops shared with you, and pages, act on the drop open, or make a new drop. Type in: and a folder, or kind: and a kind, to narrow the drops."
    :groups="groups"
    :color-mode="false"
    preserve-group-order
    :search-delay="0"
    :transition="false"
    :loading="pending && !unknownFolder"
    placeholder="Search drops, docs and pages, or make one"
    title="Search"
    :ui="{ itemDescription: 'line-clamp-2 whitespace-normal', itemLabelSuffix: 'truncate', footer: 'p-0' }"
  >
    <template #empty>
      <p class="py-6 text-center text-sm text-muted">
        <template v-if="unknownFolder">No folder named “{{ parsed.folder }}”.</template>
        <template v-else>{{ pending ? "Searching…" : "Nothing matches." }}</template>
      </p>
    </template>
    <template #footer>
      <div
        class="flex items-center gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none]"
        role="group"
        aria-label="Filters"
      >
        <button
          v-if="scope"
          :aria-pressed="searched?.id === scope.id"
          class="max-w-48"
          :class="chip(searched?.id === scope.id)"
          type="button"
          @click="term = toggleFolder(term, scope.title)"
          @mousedown.prevent
        >
          <UIcon class="size-3.5 shrink-0" name="i-mingcute-folder-line" />
          <span class="truncate">{{ scope.title }}</span>
        </button>
        <span v-if="scope" aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-(--ui-border)" />
        <button
          v-for="item in kinds"
          :key="item.kind"
          :aria-pressed="parsed.kinds.includes(item.kind)"
          :class="chip(parsed.kinds.includes(item.kind))"
          type="button"
          @click="term = toggleKind(term, item.kind)"
          @mousedown.prevent
        >
          <UIcon class="size-3.5 shrink-0" :name="KIND_ICONS[item.kind]" />
          {{ item.label }}
        </button>
      </div>
    </template>
  </UDashboardSearch>
</template>
