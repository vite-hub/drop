import * as Y from "yjs"

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] }
type Handler<T> = (change: T, origin: unknown) => void

type Socket = WebSocket & { paced?: boolean }

/** The y-websocket provider internals these workarounds replace. */
export interface PatchableProvider {
  doc: Y.Doc
  ws: Socket | null
  on(event: "status", fn: () => void): void
  awareness: { clientID: number; on(event: "update", fn: Handler<AwarenessChange>): void; off(event: "update", fn: Handler<AwarenessChange>): void }
  _awarenessUpdateHandler: Handler<AwarenessChange> & { patched?: boolean }
  _updateHandler: Handler<Uint8Array> & { patched?: boolean }
}

/**
 * ViteHub's Realtime server closes a peer whose document updates arrive under 50ms apart (1013). Updates sent 60ms
 * apart still arrived closer than that, so leave room for network jitter.
 */
const UPDATE_INTERVAL_MS = 150

/**
 * Two rules of ViteHub's Realtime server that y-websocket breaks, worked around on the client until vite-hub/realtime
 * does it itself:
 * - y-websocket relays every awareness change it hears, other people's too, and the server closes a peer (4500) that
 *   sends a client id another peer owns, so rooms with two people kept dropping. Send only our own client.
 * - It sends one document update per keystroke, and holding a key sends them faster than the server accepts; its
 *   reply to the server's first sync counts too. Merge updates, and space every document message on the socket.
 */
export function patchRealtimeProvider(provider: PatchableProvider) {
  const relay = provider._awarenessUpdateHandler
  if (!relay.patched) {
    const own = (ids: number[]) => ids.filter(id => id === provider.awareness.clientID)
    const ownOnly = Object.assign((change: AwarenessChange, origin: unknown) => {
      const mine = { added: own(change.added), updated: own(change.updated), removed: own(change.removed) }
      if (mine.added.length || mine.updated.length || mine.removed.length) relay(mine, origin)
    }, { patched: true })
    provider.awareness.off("update", relay)
    provider.awareness.on("update", ownOnly)
    provider._awarenessUpdateHandler = ownOnly
  }

  const send = provider._updateHandler
  if (!send.patched) {
    let pending: Uint8Array[] = []
    let sentAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      timer = undefined
      if (!pending.length) return
      const update = pending.length === 1 ? pending[0]! : Y.mergeUpdates(pending)
      pending = []
      sentAt = Date.now()
      send(update, null)
    }
    const batched = Object.assign((update: Uint8Array, origin: unknown) => {
      if (origin === provider) return
      pending.push(update)
      timer ??= setTimeout(flush, Math.max(0, UPDATE_INTERVAL_MS - (Date.now() - sentAt)))
    }, { patched: true })
    provider.doc.off("update", send)
    provider.doc.on("update", batched)
    provider._updateHandler = batched
  }

  pace(provider.ws)
  provider.on("status", () => pace(provider.ws))
}

/** Holds back document messages (sync step 2 and updates; awareness passes) so they leave at least an interval apart. */
function pace(socket: Socket | null) {
  if (!socket || socket.paced) return
  socket.paced = true
  const send = socket.send.bind(socket)
  const queue: Parameters<WebSocket["send"]>[0][] = []
  let sentAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const pump = () => {
    timer = undefined
    const next = queue.shift()
    if (next === undefined || socket.readyState !== WebSocket.OPEN) return void (queue.length = 0)
    send(next)
    sentAt = Date.now()
    if (queue.length) timer = setTimeout(pump, UPDATE_INTERVAL_MS)
  }
  socket.send = (data) => {
    const bytes = new Uint8Array(data as ArrayBufferLike)
    if (bytes[0] !== 0 || bytes[1] === 0) return send(data)
    if (!timer && Date.now() - sentAt >= UPDATE_INTERVAL_MS) {
      send(data)
      sentAt = Date.now()
      return
    }
    queue.push(data)
    timer ??= setTimeout(pump, Math.max(0, UPDATE_INTERVAL_MS - (Date.now() - sentAt)))
  }
}
