import { type FrameMessage, parseFrameMessage } from "#shared/frame-messages"

/**
 * The postMessage bridge to the sandboxed iframe. Messages are matched by source window. An opaque-origin frame
 * has no origin to check; a frame on the content origin (`origin`) must also come from, and only hears back on,
 * that origin, so nothing reaches a page the app navigated away to. The frame runs the drop's own code, so a message
 * that isn't one Drop's runtime sends (#shared/frame-messages) is dropped. `rect` is the frame's box, for turning
 * frame coordinates into page ones.
 */
export function useDropFrame(
  frame: Readonly<Ref<HTMLIFrameElement | null | undefined>>,
  origin: MaybeRefOrGetter<string | undefined>,
  onMessage: (message: FrameMessage, rect: DOMRect) => void,
) {
  const ready = ref(false)
  useEventListener("message", (event: MessageEvent) => {
    if (!frame.value || event.source !== frame.value.contentWindow) return
    if (toValue(origin) && event.origin !== toValue(origin)) return
    const message = parseFrameMessage(event.data)
    if (!message) return
    if (message.type === "ready") ready.value = true
    onMessage(message, frame.value.getBoundingClientRect())
  })
  const send = (message: Record<string, unknown>) =>
    frame.value?.contentWindow?.postMessage({ __drop: true, ...message }, toValue(origin) || "*")
  return { ready, send }
}
