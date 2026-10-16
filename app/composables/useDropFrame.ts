/** Messages the sandboxed drop sends up (see shared/plan-runtime.ts). */
export type FrameMessage =
  | { type: "ready" }
  | { type: "navigate"; path: string }
  | { type: "copy"; text: string }
  | { type: "selection"; clear?: boolean; quote: string; selector: string; label: string; rect: { left: number; top: number; right: number; bottom: number } }
  | { type: "image"; src: string; alt: string; selector: string; label: string; rect?: { left: number; top: number; right: number; bottom: number } }
  | { type: "area"; selector: string; label: string; ox: number; oy: number; ow: number; oh: number; rect: { left: number; top: number; right: number; bottom: number } }
  | { type: "marker"; id: string; clientX: number; clientY: number }
  | { type: "key"; key: string }
  | { type: "host"; path: string }
  | { type: "location"; path: string }
  | { type: "frame-request"; id: string; path: string }

/**
 * The postMessage bridge to the sandboxed iframe. Messages are matched by source window. An opaque-origin frame
 * has no origin to check; a frame on the content origin (`origin`) must also come from, and only hears back on,
 * that origin, so nothing reaches a page the app navigated away to. `rect` is the frame's box, for turning frame
 * coordinates into page ones.
 */
export function useDropFrame(frame: Readonly<Ref<HTMLIFrameElement | null | undefined>>, origin: MaybeRefOrGetter<string | undefined>, onMessage: (message: FrameMessage, rect: DOMRect) => void) {
  const ready = ref(false)
  useEventListener(import.meta.client ? window : undefined, "message", (event: MessageEvent) => {
    const message = event.data as (FrameMessage & { __drop?: boolean }) | null
    if (!message?.__drop || !frame.value || event.source !== frame.value.contentWindow) return
    if (toValue(origin) && event.origin !== toValue(origin)) return
    if (message.type === "ready") ready.value = true
    onMessage(message, frame.value.getBoundingClientRect())
  })
  const send = (message: Record<string, unknown>) => frame.value?.contentWindow?.postMessage({ __drop: true, ...message }, toValue(origin) || "*")
  return { ready, send }
}
