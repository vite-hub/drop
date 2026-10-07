import { breakpointsTailwind } from "@vueuse/core"
import type { SideTab } from "~/utils/viewer"

/**
 * The viewer's side panel: a pushed column on wide screens, a slideover below `lg`. Open state and tab come
 * from cookies (useSidePanel) so SSR renders the same layout; the server assumes a laptop width.
 */
export function useViewerPanel(options: { isApp: Ref<boolean>; owner: Ref<boolean>; openCount: Ref<number>; fileCount: Ref<number | undefined> }) {
  const wide = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 }).greaterOrEqual("lg")
  const { open: stored, tab: storedTab } = useSidePanel()
  const sideOpen = computed({ get: () => stored.value && wide.value, set: value => (stored.value = value) })
  const mobileSide = ref(false)

  const tabs = computed(() => [
    { value: "comments" as const, label: "Comments", count: options.openCount.value },
    { value: "source" as const, label: options.isApp.value ? "Files" : "Source", count: options.isApp.value ? options.fileCount.value : undefined },
    ...(options.owner.value ? [{ value: "details" as const, label: "Details" }] : []),
  ])
  const tab = computed<SideTab>({
    get: () => (tabs.value.some(item => item.value === storedTab.value) ? storedTab.value : "comments"),
    set: value => (storedTab.value = value),
  })

  return {
    wide,
    sideOpen,
    mobileSide,
    tabs,
    tab,
    toggle: () => (wide.value ? (sideOpen.value = !sideOpen.value) : (mobileSide.value = !mobileSide.value)),
    close: () => (wide.value ? (sideOpen.value = false) : (mobileSide.value = false)),
    show(value: SideTab) {
      tab.value = value
      if (wide.value) sideOpen.value = true
      else mobileSide.value = true
    },
  }
}
