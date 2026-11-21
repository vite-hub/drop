import { appLocation, appPageFor, pageUrl } from "#shared/project-bundle"
import type { DropDetail } from "#shared/types"

export function useAppFiles(drop: Ref<DropDetail>) {
  const route = useRoute()
  const setQuery = useSetQuery()
  const files = computed(() => drop.value.files ?? {})
  const pages = computed(() => appPages(drop.value.paths ?? Object.keys(files.value)))
  const location = ref("/")
  const page = computed({
    get: () => appPageFor(pages.value, location.value),
    set: (value) => {
      if (value !== page.value) location.value = pageUrl(value)
    },
  })

  const written = new Set<string>()
  function openFromQuery() {
    if (drop.value.kind !== "app") return
    const path = textValue(route.query.path)
    if (path !== undefined && written.delete(path)) return
    const file = textValue(route.query.file)
    location.value = appLocation(path, route.hash) ?? (file && pages.value.includes(file) ? pageUrl(file) : null) ?? "/"
  }
  watch([() => route.query.path, () => route.query.file, () => route.hash, () => drop.value.id], openFromQuery, {
    immediate: true,
  })
  watch(location, async (value) => {
    if (drop.value.kind !== "app") return
    const path = value === "/" ? undefined : value
    if (path !== undefined && path !== textValue(route.query.path)) written.add(path)
    try {
      await setQuery({ path, file: undefined }, { hash: "" })
    } finally {
      if (path !== undefined) written.delete(path)
    }
  })

  return { files, pages, page, location }
}
