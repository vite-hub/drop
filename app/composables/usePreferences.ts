import type { DocWidth } from "#shared/documents"
import type { DeviceFrameSize } from "vite-hub/ui"

const year = 60 * 60 * 24 * 365

export const useFolderPreviewWidth = () =>
  useCookie<number>("drop-folder-preview-width", { default: () => 22, maxAge: year, sameSite: "lax" })

export const useDropsView = () =>
  useCookie<"pinned" | "recent" | "folders">("drop-drops-view", {
    default: () => "pinned",
    maxAge: year,
    sameSite: "lax",
  })
export const useDropsLayout = () =>
  useCookie<"grid" | "list">("drop-drops-layout", { default: () => "grid", maxAge: year, sameSite: "lax" })
export const useDocWidth = () =>
  useCookie<DocWidth>("drop-doc-width", { default: () => "readable", maxAge: year, sameSite: "lax" })

export const useZen = () => useCookie<boolean>("drop-zen", { default: () => false, maxAge: year, sameSite: "lax" })

export type CommentStyle = "card" | "pin"
export const useCommentStyle = () =>
  useCookie<CommentStyle>("drop-comment-style", { default: () => "card", maxAge: year, sameSite: "lax" })
export const useCommentsShown = () =>
  useCookie<boolean>("drop-comments-shown", { default: () => true, maxAge: year, sameSite: "lax" })

export const useDeviceSize = () =>
  useCookie<DeviceFrameSize>("drop-device-mode", {
    default: () => ({ on: false, id: "iphone", width: 393, height: 852, zoom: null }),
    maxAge: year,
    sameSite: "lax",
  })

export const useGetStartedHidden = () =>
  useCookie<boolean>("drop-get-started-hidden", { default: () => false, maxAge: year, sameSite: "lax" })

export const useSidebarCollapsed = () =>
  useState<boolean>(
    "drop-sidebar-collapsed",
    () => !!useCookie<{ collapsed?: boolean } | null>("drop-sidebar-nav").value?.collapsed,
  )

export const useOpenedOnLink = () =>
  useState<boolean>("drop-opened-on-link", () => import.meta.server && useRoute().name === "d-id-slug")

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

export const useTreeOpen = () => useState<Record<string, boolean>>("drop-tree-open", () => ({}))

const tick = createSharedComposable(() => {
  const now = useState<number>("now")
  now.value = Date.now()
  useIntervalFn(() => (now.value = Date.now()), 30_000)
})

export function useRelativeNow() {
  const now = useState("now", () => Date.now())
  if (import.meta.client) onMounted(tick)
  return now
}

export const COPY_MS = 1400

export function useCopy() {
  const notify = useNotify()
  const { copy: write } = useClipboard({ legacy: true })
  const last = ref<string>()
  const { start } = useTimeoutFn(() => (last.value = undefined), COPY_MS, { immediate: false })
  type Options = { key?: string; announce?: string }
  function done({ key = "", announce }: Options) {
    last.value = key
    start()
    if (announce) notify.done(announce)
  }
  function failed(error: unknown) {
    reportClientError("copy", error)
    notify.alert("Couldn't copy")
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
