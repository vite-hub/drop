import type { SideTab } from "~/utils/viewer"

const year = 60 * 60 * 24 * 365

/**
 * UI preferences that change the layout. They live in cookies, not localStorage, so the server renders
 * the same layout the browser will show: no flash of a closed panel, no hydration mismatch.
 */
export function useSidePanel() {
  const open = useCookie<boolean>("drop-side-open", { default: () => true, maxAge: year, sameSite: "lax" })
  const tab = useCookie<SideTab>("drop-side-tab", { default: () => "comments", maxAge: year, sameSite: "lax" })
  return { open, tab }
}

/** Which folders and apps are expanded in the sidebar tree. Shared state, so it survives navigation. */
export const useTreeOpen = () => useState<Record<string, boolean>>("drop-tree-open", () => ({}))

/** Which folders are expanded on the Drops page, at every level. */
export const useRowsOpen = () => useState<Record<string, boolean>>("drop-rows-open", () => ({}))

// One timer for every relative time on the page, alive while any of them is mounted. It catches up first, since
// `now` may have sat still while nothing showed a time.
const tick = createSharedComposable(() => {
  const now = useState<number>("now")
  now.value = Date.now()
  useIntervalFn(() => (now.value = Date.now()), 30_000)
})

/**
 * "Now" for relative times ("3m ago"). Taken once on the server and reused on hydration, so server and
 * client print the same text; then it ticks every 30 seconds in the browser.
 */
export function useRelativeNow() {
  const now = useState("now", () => Date.now())
  // Client only: on the server a shared composable would be shared across requests.
  if (import.meta.client) onMounted(tick)
  return now
}

/** Copy with a toast; `copied` flips for a moment so buttons can show a check. */
export function useCopy() {
  const toast = useToast()
  const { copy, copied } = useClipboard({ copiedDuring: 1400, legacy: true })
  return {
    copied,
    async copy(text: string, title = "Copied") {
      await copy(text)
      toast.add({ title })
    },
  }
}
