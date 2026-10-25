/**
 * Drags a panel on the right wider from its left edge, in rem, between `min` and `max`; double-click resets it to
 * `initial`, and the arrow keys step it by 1rem for people on a keyboard. Bind `handle` on the separator: it captures
 * the pointer, so the drag keeps going over an iframe.
 */
export function useResizeHandle(width: Ref<number>, bounds: { min: number; max: number; initial: number }) {
  const clamp = (value: number) => Math.round(Math.min(bounds.max, Math.max(bounds.min, value)) * 10) / 10
  let drag: { x: number; width: number; rem: number } | undefined
  const handle = {
    onPointerdown(event: PointerEvent) {
      if (!(event.currentTarget instanceof Element) || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      drag = { x: event.clientX, width: width.value, rem }
    },
    onPointermove(event: PointerEvent) {
      if (drag) width.value = clamp(drag.width + (drag.x - event.clientX) / drag.rem)
    },
    onLostpointercapture: () => (drag = undefined),
    onDblclick: () => (width.value = bounds.initial),
    onKeydown(event: KeyboardEvent) {
      const step = { ArrowLeft: 1, ArrowRight: -1 }[event.key]
      if (!step) return
      event.preventDefault()
      width.value = clamp(width.value + step)
    },
  }
  return { handle, width: computed(() => clamp(width.value)) }
}
