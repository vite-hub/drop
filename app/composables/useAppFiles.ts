import { appLocation, appPageFor, pageUrl } from "#shared/project-bundle"
import type { DropDetail } from "#shared/types"

/**
 * An app's pages, the address its frame shows (`location`: path, query and hash), and the page a static host answers
 * that address with. The address lives in the drop link's `?path=`, so a link opens the app at that page and a copied
 * address bar reopens it. `?file=` from older links still opens its page.
 */
export function useAppFiles(drop: Ref<DropDetail>) {
  const route = useRoute()
  const setQuery = useSetQuery()
  const files = computed(() => drop.value.files ?? {})
  const pages = computed(() => appPages(Object.keys(files.value)))
  const location = ref("/")
  const page = computed({
    get: () => appPageFor(pages.value, location.value),
    // A page picked by its file (a comment's, the opaque frame's link) opens at its URL, unless the frame is there.
    set: (value) => {
      if (value !== page.value) location.value = pageUrl(value)
    },
  })

  // The addresses this viewer wrote to `?path=` itself and the route hasn't reached yet: when it does, it's no news.
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
    // The app's own hash is in `?path=` now: one left after it would land on the next page too.
    try {
      await setQuery({ path, file: undefined }, { hash: "" })
    } finally {
      // Canceled navigations never reach openFromQuery; they must not hide a later visit to that address.
      if (path !== undefined) written.delete(path)
    }
  })

  return { files, pages, page, location }
}
