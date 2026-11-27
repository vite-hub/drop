import type { CommandPaletteItem } from "@nuxt/ui"
import type { MaybeRefOrGetter } from "vue"
import type { DropKind } from "#shared/types"
import { isUiControl, KEY_CONTROLS, type UiControl, type UiVia } from "#shared/ui-usage"

declare module "h3" {
  interface H3EventContext {
    dropUsageCounts?: boolean
  }
}

export const useUiUsageEnabled = () =>
  useState("drop-usage-counts", () => Boolean(import.meta.server && useRequestEvent()?.context.dropUsageCounts))

let counter: ReturnType<typeof createUsageCounter> | undefined

const visible = (element: Element) =>
  !element.closest("[inert]") &&
  (typeof element.checkVisibility !== "function" ||
    element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }))

export function useUiUsage(options: {
  pill: MaybeRefOrGetter<HTMLElement | null | undefined>
  kind: () => DropKind
  commenting: () => boolean
  view: () => string
  hidden: () => boolean
}) {
  const counting = useUiUsageEnabled()
  const client = typeof window !== "undefined"
  const usage = client
    ? (counter ??= createUsageCounter({ on: () => counting.value, send: sendClientEvent }))
    : undefined
  const later = useTimeoutFn(flush, 30_000, { immediate: false })
  function flush() {
    later.stop()
    usage?.flush()
  }
  function count(control: UiControl, via: UiVia, commenting = options.commenting()) {
    usage?.add({ kind: options.kind(), mode: commenting ? "comment" : "browse", control, via })
    if (!usage?.pending) later.stop()
    else if (!later.isPending.value) later.start()
  }
  let shown = new Set<UiControl>()
  let shownView: string | undefined
  function scan() {
    const view = options.view()
    if (view !== shownView) {
      shown = new Set()
      shownView = view
    }
    const pill = toValue(options.pill)
    const now = new Set<UiControl>()
    if (pill && !options.hidden()) {
      for (const element of pill.querySelectorAll("[data-usage]")) {
        const control = element.getAttribute("data-usage")
        if (isUiControl(control) && visible(element)) now.add(control)
      }
    }
    for (const control of now) if (!shown.has(control)) count(control, "shown")
    shown = now
  }
  const soon = useRafFn(scan, { once: true, immediate: false })
  const queue = () => counting.value && !soon.isActive.value && soon.resume()
  if (client && counting.value) {
    useEventListener(
      () => toValue(options.pill),
      "click",
      (event: MouseEvent) => {
        if (!(event.target instanceof Element)) return
        const target = event.target.closest("[data-usage]")
        if (!target || !toValue(options.pill)?.contains(target)) return
        const control = target.getAttribute("data-usage")
        if (isUiControl(control)) count(control, "click")
      },
      { capture: true },
    )
    useMutationObserver(() => toValue(options.pill), queue, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "inert", "style", "data-usage"],
    })
    useEventListener(() => toValue(options.pill), "transitionend", queue)
    useResizeObserver(() => toValue(options.pill), queue)
    useEventListener(window, "resize", queue)
    watch(options.hidden, queue)
    watch([() => toValue(options.pill), options.view, options.commenting], queue, { immediate: true })
    useEventListener(window, "pagehide", flush)
    useEventListener(document, "visibilitychange", () => document.visibilityState === "hidden" && flush())
    onBeforeUnmount(flush)
  }

  function key(shortcut: string, action: () => boolean | undefined) {
    const commenting = options.commenting()
    const control = KEY_CONTROLS[shortcut]
    if (action() && control) count(control, "key", commenting)
  }

  return {
    key,
    palette(control: UiControl, select: NonNullable<CommandPaletteItem["onSelect"]>) {
      return (event: Event) => {
        count(control, "palette")
        return select(event)
      }
    },
  }
}
