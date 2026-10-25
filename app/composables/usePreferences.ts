import type { DocWidth } from "#shared/documents"
import type { DeviceSize } from "~/utils/devices"
import type { SideTab } from "~/utils/viewer"

const year = 60 * 60 * 24 * 365

/**
 * UI preferences that change the layout. They live in cookies, not localStorage, so the server renders
 * the same layout the browser will show: no flash of a closed panel, no hydration mismatch.
 */
export function useSidePanel() {
  // Details and History live here. Comments have their own bottom dock.
  const open = useCookie<boolean>("drop-side-panel", { default: () => false, maxAge: year, sameSite: "lax" })
  const tab = useCookie<SideTab>("drop-side-tab", { default: () => "details", maxAge: year, sameSite: "lax" })
  // In rem, like the sidebar's (UDashboardGroup's unit), so the server renders the width they left it at.
  const width = useCookie<number>("drop-side-width", { default: () => 24, maxAge: year, sameSite: "lax" })
  return { open, tab, width }
}

/** How wide a folder's preview pane is, in rem like the side panel's, dragged from its left edge. */
export const useFolderPreviewWidth = () =>
  useCookie<number>("drop-folder-preview-width", { default: () => 22, maxAge: year, sameSite: "lax" })

/** How wide Markdown docs read (DOC_WIDTHS), from Details or W. */
export const useDocWidth = () =>
  useCookie<DocWidth>("drop-doc-width", { default: () => "readable", maxAge: year, sameSite: "lax" })

/** Device mode for HTML docs, apps, Markdown docs, and reviewed sites (ViewerDevice), for every drop. */
export const useDeviceSize = () =>
  useCookie<DeviceSize>("drop-device-mode", {
    default: () => ({ on: false, id: "iphone", width: 393, height: 852, zoom: null }),
    maxAge: year,
    sameSite: "lax",
  })

/** Whether the Drops page's Get started checklist was dismissed. A cookie, so a dismissed checklist never flashes in. */
export const useGetStartedHidden = () =>
  useCookie<boolean>("drop-get-started-hidden", { default: () => false, maxAge: year, sameSite: "lax" })

/**
 * Whether the sidebar is folded away (⌘B). The dashboard layout binds it to the sidebar, which keeps it in its cookie;
 * the pages' top bars read it to show the button that brings the sidebar back. It starts from that cookie (Nuxt UI's
 * `<storage-key>-sidebar-<id>`): the sidebar reads it only in its own setup, after the server rendered the layout.
 */
export const useSidebarCollapsed = () =>
  useState<boolean>(
    "drop-sidebar-collapsed",
    () => !!useCookie<{ collapsed?: boolean } | null>("drop-sidebar-nav").value?.collapsed,
  )

/**
 * Whether the app opened on a drop's link, from a pull request or a chat. That first page reads without the sidebar,
 * whatever ⌘B saved, and leaves the saved choice alone: the sidebar comes back on the next page, with ⌘B, or with Show
 * sidebar. Decided on the server, so the page renders without it.
 */
export const useOpenedOnLink = () =>
  useState<boolean>("drop-opened-on-link", () => import.meta.server && useRoute().name === "d-id-slug")

/** Whether the sidebar is out of sight, folded or skipped on a link, and the ⌘B toggle that shows it or folds it. */
export function useSidebarHidden() {
  const collapsed = useSidebarCollapsed()
  const onLink = useOpenedOnLink()
  const hidden = computed(() => collapsed.value || onLink.value)
  function toggle() {
    const fold = !hidden.value
    onLink.value = false
    collapsed.value = fold
  }
  return { hidden, toggle }
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

/**
 * Copy without a toast: the button that copied shows a check while `copied(key)` holds, for a moment. A copy whose
 * button goes away with the click (a menu item) passes `announce`, and a toast says it instead. A failure toasts.
 */
export function useCopy() {
  const toast = useToast()
  const { copy: write } = useClipboard({ legacy: true })
  const last = ref<string>()
  const { start } = useTimeoutFn(() => (last.value = undefined), 1400, { immediate: false })
  type Options = { key?: string; announce?: string }
  function done({ key = "", announce }: Options) {
    last.value = key
    start()
    if (announce) toast.add({ title: announce, icon: "i-mingcute-check-line" })
  }
  function failed(error: unknown) {
    reportClientError("copy", error)
    toast.add({ title: "Couldn't copy", color: "error", icon: "i-mingcute-warning-line" })
  }
  return {
    copied: (key = "") => last.value === key,
    copy: async (text: string, options: Options = {}) => {
      try {
        await write(text)
        done(options)
      } catch (error) {
        failed(error)
      }
    },
    /**
     * Copy text that's still loading. Safari only lets a click write the clipboard straight away, so where it can the
     * write starts now and the browser waits for the text.
     */
    copyLoading: async (text: Promise<string>, options: Options = {}) => {
      try {
        if ("ClipboardItem" in globalThis && navigator.clipboard?.write)
          await navigator.clipboard.write([
            new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) }),
          ])
        else await write(await text)
        done(options)
      } catch (error) {
        failed(error)
      }
    },
  }
}
