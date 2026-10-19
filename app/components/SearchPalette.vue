<script setup lang="ts">
// The ⌘K palette on every dashboard page: drops you can open (yours at any depth, then teammates'), matched by name or
// by a doc's words on the server, and the app's pages, matched here. The sidebar's search button opens it too.
import type { CommandPaletteGroup, CommandPaletteItem } from "@nuxt/ui"
import type { DropSummary } from "#shared/types"

const { data: me } = useMe()
const shortcutsOpen = useShortcutsOpen()
const { data: recent } = useDrops()
const term = ref("")
const query = refDebounced(computed(() => term.value.trim()), 150)
const { data: found, status } = useApi<DropSummary[]>("/api/search", { key: "search", query: computed(() => ({ q: query.value })), default: () => [], immediate: false, server: false })

/** Where a drop lives: whose it is when it isn't yours, then its folders. */
function where(drop: DropSummary) {
  const folders = drop.path?.map(crumb => crumb.title).join(" / ")
  return [drop.owner?.name, folders && `in ${folders}`].filter(Boolean).join(" · ") || undefined
}
const toItem = (drop: DropSummary): CommandPaletteItem => ({
  id: drop.id, label: drop.title, suffix: where(drop), description: drop.snippet, icon: KIND_ICONS[drop.kind] ?? "i-ph-file", to: `/drops/${drop.id}`,
})

// Plain links: the three /drops tabs would all read as the current page otherwise.
const pages = computed<CommandPaletteItem[]>(() => [
  { label: "Drops", icon: "i-ph-stack", to: "/drops" },
  { label: "Shared with me", icon: "i-ph-tray", to: "/drops?tab=with-me" },
  { label: "Trash", icon: "i-ph-trash", to: "/drops?tab=trash" },
  { label: "Agents", icon: "i-ph-sparkle", to: "/agents" },
  { label: "Skills", icon: "i-ph-puzzle-piece", to: "/skills" },
  { label: "Members", icon: "i-ph-users", to: "/members" },
  { label: "Keyboard shortcuts", icon: "i-ph-keyboard", kbds: ["?"], onSelect: () => (shortcutsOpen.value = true) },
  ...(me.value?.role === "admin"
    ? [{ label: "Review shares", icon: "i-ph-seal-check", to: "/admin/review" }, { label: "Reports", icon: "i-ph-flag", to: "/admin/reports" }]
    : []),
  ...DOCS_PAGES.map(page => ({ label: page.label, suffix: "Docs", icon: "i-ph-book-open", to: page.to })),
].map(page => ({ ...page, active: false })))

// Until the debounced words reach the server, the last results would answer the new words: show none instead.
const settled = computed(() => query.value === term.value.trim())
// With words, matching pages go first: there are few, and most searches match none. Without, your latest drops.
const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => term.value.trim()
  ? [{ id: "pages", label: "Go to", items: pages.value }, { id: "drops", label: "Drops", ignoreFilter: true, items: settled.value ? found.value.map(toItem) : [] }]
  : [{ id: "recent", label: "Recent", ignoreFilter: true, items: recent.value.slice(0, 5).map(toItem) }, { id: "pages", label: "Go to", items: pages.value }])
</script>

<template>
  <UDashboardSearch
    v-model:search-term="term"
    :color-mode="false"
    description="Search your drops, drops shared with you, and pages."
    :groups="groups"
    :loading="status === 'pending' || !settled"
    placeholder="Search drops, docs and pages"
    title="Search"
    :ui="{ itemDescription: 'line-clamp-2 whitespace-normal', itemLabelSuffix: 'truncate' }"
  >
    <template #empty>
      <p class="py-6 text-center text-sm text-muted">{{ status === 'pending' || !settled ? "Searching…" : "Nothing matches." }}</p>
    </template>
  </UDashboardSearch>
</template>
