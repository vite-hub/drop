import { connectRealtimeRoom } from "vite-hub/realtime/client"

export function useLatestRoom(link: () => string, enabled: () => boolean): Readonly<Ref<number>> {
  const digest = shallowRef(0)
  watch(
    () => (enabled() ? link() : null),
    (id, _before, onCleanup) => {
      digest.value = 0
      if (!id) return
      const room = connectRealtimeRoom("latest", id)
      room.onUpdate(() => {
        digest.value = Number(room.saveStatus()?.digest) || 0
      })
      onCleanup(() => room.destroy())
    },
    { immediate: true },
  )
  return digest
}
