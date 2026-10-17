import { breakpointsTailwind } from "@vueuse/core"
import type { SideTab } from "~/utils/viewer"

/**
 * The viewer's side panel: a card floating over the content on wide screens, a slideover below `lg`. Open state and
 * tab come from cookies (useSidePanel) so SSR renders the same layout; the server assumes a laptop width.
 */
export function useViewerPanel(options: { owner: Ref<boolean>; openCount: Ref<number> }) {
  const wide = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 }).greaterOrEqual("lg")
  const { open: stored, tab: storedTab } = useSidePanel()
  const sideOpen = computed({ get: () => stored.value && wide.value, set: value => (stored.value = value) })
  const mobileSide = ref(false)

  const tabs = computed(() => [
    { value: "comments" as const, label: "Comments", count: options.openCount.value },
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
