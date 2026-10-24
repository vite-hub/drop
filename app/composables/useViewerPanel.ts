import { breakpointsTailwind } from "@vueuse/core"
import type { SideTab } from "~/utils/viewer"

/** The side panel's width range, in rem. */
const SIDE_WIDTH = { min: 20, max: 36, default: 24 }

/**
 * The viewer's side panel: a full-height column beside the page on wide screens, resized from its left edge, and a
 * slideover below `lg`. Open state, tab and width come from cookies (useSidePanel) so SSR renders the same layout; the
 * server assumes a laptop width.
 */
export function useViewerPanel(options: {
  details: Ref<boolean>
  openCount: Ref<number>
  versions: Ref<number>
  comments: Ref<boolean>
}) {
  const wide = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 }).greaterOrEqual("lg")
  const { open: stored, tab: storedTab, width } = useSidePanel()
  const sideOpen = computed({ get: () => stored.value && wide.value, set: (value) => (stored.value = value) })
  const mobileSide = ref(false)

  // A folder takes no comments of its own: what it holds does.
  const tabs = computed(() => [
    ...(options.comments.value
      ? [
          {
            value: "comments" as const,
            label: "Comments",
            icon: "i-mingcute-chat-3-line",
            count: options.openCount.value,
          },
        ]
      : []),
    // Anyone who can open the drop can read its history; Details (sharing, lifetime) stays with its managers, and with
    // whoever files into a folder that says what goes in it.
    ...(options.versions.value > 1
      ? [{ value: "history" as const, label: "History", icon: "i-mingcute-history-line" }]
      : []),
    ...(options.details.value
      ? [{ value: "details" as const, label: "Details", icon: "i-mingcute-information-line" }]
      : []),
  ])
  const tab = computed<SideTab>({
    get: () =>
      tabs.value.some((item) => item.value === storedTab.value)
        ? storedTab.value
        : (tabs.value[0]?.value ?? "comments"),
    set: (value) => (storedTab.value = value),
  })

  // Nuxt UI's resizable panels grow from their right edge; this one sits on the right, so it grows leftwards. The handle
  // captures the pointer, so the drag keeps going over the page's frame.
  let drag: { x: number; width: number; rem: number } | undefined
  const resize = {
    start(event: PointerEvent) {
      if (!(event.currentTarget instanceof Element)) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      drag = { x: event.clientX, width: width.value, rem }
    },
    move(event: PointerEvent) {
      if (!drag) return
      const next = drag.width + (drag.x - event.clientX) / drag.rem
      width.value = Math.round(Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, next)) * 10) / 10
    },
    end: () => (drag = undefined),
    reset: () => (width.value = SIDE_WIDTH.default),
  }

  return {
    wide,
    width,
    resize,
    sideOpen,
    mobileSide,
    tabs,
    tab,
    close: () => (wide.value ? (sideOpen.value = false) : (mobileSide.value = false)),
    show(value: SideTab) {
      tab.value = value
      if (wide.value) sideOpen.value = true
      else mobileSide.value = true
    },
  }
}
