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

/** Which app folders are expanded in the sidebar tree. Shared state, so it survives navigation. */
export const useTreeOpen = () => useState<Record<string, boolean>>("drop-tree-open", () => ({}))

/**
 * "Now" for relative times ("3m ago"). Taken once on the server and reused on hydration, so server and
 * client print the same text; then it ticks every 30 seconds in the browser.
 */
export function useRelativeNow() {
  const now = useState("now", () => Date.now())
  useIntervalFn(() => (now.value = Date.now()), 30_000, { immediate: import.meta.client })
  return now
}

/** Copy with a toast; `copied` flips for a moment so buttons can show a check. */
export function useCopy() {
  const toast = useToast()
  const { copy, copied, isSupported } = useClipboard({ copiedDuring: 1400, legacy: true })
  return {
    copied,
    async copy(text: string, title = "Copied") {
      if (!isSupported.value) return toast.add({ title: "Couldn't copy", description: "Your browser blocked clipboard access." })
      await copy(text)
      toast.add({ title })
    },
  }
}
