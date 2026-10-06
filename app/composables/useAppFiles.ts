import type { DropDetail } from "#shared/types"

export type TreeRow = { path: string; name: string; depth: number; folder: boolean }

/**
 * An app's files as the viewer sees them: the drafts while editing, the published set otherwise. Tracks the
 * previewed page and the file open in the code view, and follows `?file=` from the sidebar tree.
 */
export function useAppFiles(drop: Ref<DropDetail>, drafts: Ref<Record<string, string> | null>) {
  const route = useRoute()
  const files = computed(() => drafts.value ?? drop.value.files ?? {})
  const pages = computed(() => Object.keys(files.value).filter(path => path.endsWith(".html")).sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b))))
  const page = ref("index.html")
  const view = ref<"preview" | "code">("preview")
  const file = ref("index.html")

  /** Folders first at every level, then files, both alphabetical. */
  const treeRows = computed(() => {
    const key = (path: string) => path.split("/").map((part, index, parts) => (index < parts.length - 1 ? "0" : "1") + part.toLowerCase()).join("/")
    const rows: TreeRow[] = []
    const folders = new Set<string>()
    for (const path of Object.keys(files.value).sort((a, b) => key(a).localeCompare(key(b)))) {
      const parts = path.split("/")
      for (let index = 1; index < parts.length; index++) {
        const folder = parts.slice(0, index).join("/")
        if (!folders.has(folder)) {
          folders.add(folder)
          rows.push({ path: folder, name: parts[index - 1]!, depth: index - 1, folder: true })
        }
      }
      rows.push({ path, name: parts.at(-1)!, depth: parts.length - 1, folder: false })
    }
    return rows
  })

  /** HTML opens as a page in the preview; anything else opens in the code view. */
  function openFile(path: string) {
    file.value = path
    if (path.endsWith(".html")) {
      page.value = path
      view.value = "preview"
    }
    else {
      view.value = "code"
    }
  }

  function openFromQuery() {
    const target = typeof route.query.file === "string" ? route.query.file : null
    if (drop.value.kind === "app" && target && target in files.value) openFile(target)
  }
  onMounted(openFromQuery)
  watch(() => route.query.file, openFromQuery)

  return { files, pages, page, view, file, treeRows, openFile }
}
