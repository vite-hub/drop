import { breakpointsTailwind } from "@vueuse/core"
import type { SideTab } from "~/utils/viewer"

/** The side panel's width range, in rem. */
const SIDE_WIDTH = { min: 20, max: 36, default: 24 }

/**
 * The viewer's side panel: a full-height column beside the page on wide screens, resized from its left edge, and a
 * slideover below `lg`. Open state, tab and width come from cookies (useSidePanel) so SSR renders the same layout; the
 * server assumes a laptop width.
 */
export function useViewerPanel(options: { versions: Ref<number> }) {
  const wide = useBreakpoints(breakpointsTailwind, { ssrWidth: 1280 }).greaterOrEqual("lg")
  const { open: stored, tab: storedTab, width } = useSidePanel()
  const sideOpen = computed({ get: () => stored.value && wide.value, set: (value) => (stored.value = value) })
  const mobileSide = ref(false)

  // Everyone who can view the drop can inspect its metadata. Management controls check ownership themselves.
  const tabs = computed(() => [
    { value: "details" as const, label: "Details", icon: "i-mingcute-information-line" },
    ...(options.versions.value > 1
      ? [{ value: "history" as const, label: "History", icon: "i-mingcute-history-line" }]
      : []),
  ])
  const tab = computed<SideTab>({
    get: () => (tabs.value.some((item) => item.value === storedTab.value) ? storedTab.value : "details"),
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
    key(event: KeyboardEvent) {
      const next =
        event.key === "ArrowLeft"
          ? width.value + 1
          : event.key === "ArrowRight"
            ? width.value - 1
            : event.key === "Home"
              ? SIDE_WIDTH.min
              : event.key === "End"
                ? SIDE_WIDTH.max
                : undefined
      if (next === undefined) return
      event.preventDefault()
      width.value = Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, next))
    },
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
