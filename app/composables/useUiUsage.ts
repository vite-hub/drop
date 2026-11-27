import type { CommandPaletteItem } from "@nuxt/ui"
import type { MaybeRefOrGetter } from "vue"
import type { DropKind } from "#shared/types"
import { isUiControl, KEY_CONTROLS, PALETTE_CONTROLS, type UiControl, type UiVia } from "#shared/ui-usage"

declare module "h3" {
  interface H3EventContext {
    dropUsageCounts?: boolean
  }
}

const useCounting = () =>
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
}) {
  const counting = useCounting()
  const usage = import.meta.client
    ? (counter ??= createUsageCounter({ on: () => counting.value, send: sendClientEvent }))
    : undefined
  const flush = () => usage?.flush()
  const later = useTimeoutFn(flush, 30_000, { immediate: false })
  function count(control: UiControl, via: UiVia) {
    usage?.add({ kind: options.kind(), mode: options.commenting() ? "comment" : "browse", control, via })
    if (usage?.pending && !later.isPending.value) later.start()
  }
  const press = (control: UiControl | undefined, via: "key" | "palette") => control && count(control, via)

  let shown = new Set<UiControl>()
  function scan() {
    const pill = toValue(options.pill)
    if (!pill) return
    const now = new Set<UiControl>()
    for (const element of pill.querySelectorAll("[data-usage]")) {
      const control = element.getAttribute("data-usage")
      if (isUiControl(control) && visible(element)) now.add(control)
    }
    for (const control of now) if (!shown.has(control)) count(control, "shown")
    shown = now
  }
  const soon = useRafFn(scan, { once: true, immediate: false })
  const queue = () => counting.value && !soon.isActive.value && soon.resume()
  if (import.meta.client) {
    useEventListener(
      () => toValue(options.pill),
      "click",
      (event: MouseEvent) => {
        const control =
          event.target instanceof Element && event.target.closest("[data-usage]")?.getAttribute("data-usage")
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
    watch([() => toValue(options.pill), options.view], () => ((shown = new Set()), queue()), { immediate: true })
    useEventListener(window, "pagehide", flush)
    useEventListener(document, "visibilitychange", () => document.visibilityState === "hidden" && flush())
    onBeforeUnmount(flush)
  }

  return {
    press,
    keys<T extends object>(shortcuts: T): T {
      // SAFETY: the same keys, each function handler wrapped with one that takes and returns the same values.
      return Object.fromEntries(
        Object.entries(shortcuts).map(([key, handler]) => [
          key,
          typeof handler === "function" && KEY_CONTROLS[key]
            ? (...args: unknown[]) => {
                press(KEY_CONTROLS[key], "key")
                return handler(...args)
              }
            : handler,
        ]),
      ) as T
    },
    palette<T extends { groups: { items: CommandPaletteItem[] }[] } | null>(offer: T): T {
      if (!offer) return offer
      return {
        ...offer,
        groups: offer.groups.map((group) => ({
          ...group,
          items: group.items.map((item) => {
            const control = item.label ? PALETTE_CONTROLS[item.label] : undefined
            const select = item.onSelect
            if (!control || !select) return item
            return {
              ...item,
              onSelect: (event: Event) => {
                press(control, "palette")
                return select(event)
              },
            }
          }),
        })),
      }
    },
  }
}
