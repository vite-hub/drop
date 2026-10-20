import type { DropDetail } from "#shared/types"

/** An app's pages and the one in the preview. Follows `?file=` from the sidebar tree, and writes the page picked back. */
export function useAppFiles(drop: Ref<DropDetail>) {
  const route = useRoute()
  const setQuery = useSetQuery()
  const files = computed(() => drop.value.files ?? {})
  const pages = computed(() => appPages(Object.keys(files.value)))
  const page = ref("index.html")

  function openFromQuery() {
    const target = textValue(route.query.file) ?? null
    if (drop.value.kind !== "app") return
    page.value = target && pages.value.includes(target) ? target : "index.html"
  }
  watch([() => route.query.file, () => drop.value.id], openFromQuery, { immediate: true })
  watch(page, (value) => {
    const file = value === "index.html" ? undefined : value
    if (drop.value.kind === "app" && textValue(route.query.file) !== file) void setQuery({ file })
  })

  return { files, pages, page }
}
