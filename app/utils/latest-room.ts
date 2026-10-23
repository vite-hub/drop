import * as decoding from "lib0/decoding"
import * as v from "valibot"
import { WebsocketProvider } from "y-websocket"
import * as Y from "yjs"

/**
 * The room of a doc's link (server/realtime/latest.ts): its digest is the version number of the doc's head. Readers
 * need only that number, so this joins with Yjs and its socket alone, not the Tiptap editor useRealtimeTiptap brings
 * (some 200 KB). useLatestVersion imports this once the page shows. Run inside an effect scope: leaving the scope
 * leaves the room.
 *
 * It speaks ViteHub Realtime's room protocol as vite-hub/realtime/vue does: the room's status map holds the digest,
 * and message type 5 carries the server's control payloads, a session's epoch to reconnect with, or a reset (the room
 * re-seeded on publishing) that joins it afresh. Swap it for ViteHub's own client once one ships without Tiptap.
 */
export function joinLatestRoom(link: () => string, enabled: () => boolean) {
  const version = ref(0)
  let provider: WebsocketProvider | undefined

  function leave() {
    provider?.destroy()
    provider?.doc.destroy()
    provider = undefined
  }

  function join(key: string) {
    leave()
    const doc = new Y.Doc()
    const status = doc.getMap("status")
    const read = () => {
      version.value = Number(status.get("digest")) || 0
    }
    status.observe(read)
    const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/_vitehub/realtime/latest`
    const next = new WebsocketProvider(url, encodeURIComponent(key), doc, { disableBc: true, params: {} })
    // Readers show nobody their presence here.
    next.awareness.setLocalState(null)
    next.messageHandlers[5] = (_encoder, decoder) => {
      if (provider !== next) return
      const control = controlPayload(decoder)
      if (control?.type === "session") next.params.epoch = control.epoch
      else if (control?.type === "reset") join(key)
    }
    next.on("sync", (synced: boolean) => synced && read())
    provider = next
  }

  watch([link, enabled], ([key, on]) => (on && key ? join(key) : leave()), { immediate: true })
  onScopeDispose(leave)
  return computed(() => version.value)
}

const Control = v.object({ type: v.picklist(["session", "reset"]), epoch: v.pipe(v.string(), v.minLength(1)) })

function controlPayload(decoder: decoding.Decoder) {
  try {
    const parsed = v.safeParse(Control, JSON.parse(decoding.readVarString(decoder)))
    return parsed.success ? parsed.output : undefined
  } catch {}
}
