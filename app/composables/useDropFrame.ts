import { type FrameMessage, parseFrameMessage } from "#shared/frame-messages"

export type FrameBox = { left: number; top: number; scale: number }

export function useDropFrame(
  frame: Readonly<Ref<HTMLIFrameElement | null | undefined>>,
  origin: MaybeRefOrGetter<string | undefined>,
  onMessage: (message: FrameMessage, box: FrameBox) => void,
) {
  const ready = ref(false)
  useEventListener("message", (event: MessageEvent) => {
    if (!frame.value || event.source !== frame.value.contentWindow) return
    if (toValue(origin) && event.origin !== toValue(origin)) return
    const message = parseFrameMessage(event.data)
    if (!message) return
    if (message.type === "ready") ready.value = true
    const rect = frame.value.getBoundingClientRect()
    onMessage(message, { left: rect.left, top: rect.top, scale: rect.width / (frame.value.offsetWidth || rect.width) })
  })
  const send = (message: Record<string, unknown>) =>
    frame.value?.contentWindow?.postMessage({ __drop: true, ...message }, toValue(origin) || "*")
  return { ready, send }
}
