/** Messages the sandboxed drop sends up (see shared/plan-runtime.ts). */
export type FrameMessage =
  | { type: "ready" }
  | { type: "navigate"; path: string }
  | { type: "copy"; text: string }
  | { type: "edit-change"; markdown: string }
  | { type: "edit-save" }
  | { type: "edit-error"; message?: string }
  | { type: "selection"; clear?: boolean; quote: string; selector: string; label: string; rect: { left: number; top: number; right: number; bottom: number } }
  | { type: "image"; src: string; alt: string; selector: string; label: string }
  | { type: "marker"; id: string; clientX: number; clientY: number }
  | { type: "key"; key: string }

/**
 * The postMessage bridge to the sandboxed iframe. The frame has an opaque origin, so messages are matched
 * by source window, not origin. `rect` is the frame's box, for turning frame coordinates into page ones.
 */
export function useDropFrame(frame: Readonly<Ref<HTMLIFrameElement | null | undefined>>, onMessage: (message: FrameMessage, rect: DOMRect) => void) {
  const ready = ref(false)
  useEventListener(import.meta.client ? window : undefined, "message", (event: MessageEvent) => {
    const message = event.data as (FrameMessage & { __drop?: boolean }) | null
    if (!message?.__drop || !frame.value || event.source !== frame.value.contentWindow) return
    if (message.type === "ready") ready.value = true
    onMessage(message, frame.value.getBoundingClientRect())
  })
  const send = (message: Record<string, unknown>) => frame.value?.contentWindow?.postMessage({ __drop: true, ...message }, "*")
  return { ready, send }
}
