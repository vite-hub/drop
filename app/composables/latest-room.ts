import { connectRealtimeRoom } from "vite-hub/realtime/client"

/**
 * The room of a doc's link (server/realtime/latest.ts): its digest is the version number of the doc's head. It brings
 * Yjs, but no editor: only the room's save status is read. useLatestVersion imports this once the page shows, and
 * readers never wait on it. Run inside an effect scope: leaving the scope leaves the room.
 */
export function useLatestRoom(link: () => string, enabled: () => boolean): Readonly<Ref<number>> {
  const digest = shallowRef(0)
  watch(
    () => (enabled() ? link() : null),
    (id, _before, onCleanup) => {
      digest.value = 0
      if (!id) return
      const room = connectRealtimeRoom("latest", id)
      // `0` until the room syncs, and while it joins the seed of a new version.
      room.onUpdate(() => {
        digest.value = Number(room.saveStatus()?.digest) || 0
      })
      onCleanup(() => room.destroy())
    },
    { immediate: true },
  )
  return digest
}
