import type { DropDetail } from "#shared/types"
import type { RealtimeRoom } from "vite-hub/realtime/client"
import * as v from "valibot"

export interface PresencePerson {
  id: string
  name: string
  image?: string
  color: string
  at: string | null
}

export interface PresenceCursor {
  key: string
  name: string
  color: string
  selector: string
  x: number
  y: number
}

const Spot = v.object({ selector: v.pipe(v.string(), v.maxLength(1000)), x: v.number(), y: v.number() })
type Spot = v.InferOutput<typeof Spot>
const PresenceState = v.object({
  active: v.fallback(v.optional(v.boolean()), undefined),
  at: v.fallback(v.nullish(v.string()), undefined),
  cursor: v.fallback(v.nullish(Spot), undefined),
  comments: v.fallback(v.optional(v.string()), undefined),
})
const stateOf = (state: unknown) => {
  const parsed = v.safeParse(PresenceState, state)
  return parsed.success ? parsed.output : {}
}

const IDLE_MS = 60_000

export function usePresence(drop: Ref<DropDetail>, options: { at: () => string | null; enabled: () => boolean }) {
  const config = useRuntimeConfig()
  const { data: me } = useMe()
  const mounted = useMounted()
  const showCursors = useLocalStorage("drop-presence-cursors", true)
  const { idle, reset: activity } = useIdle(IDLE_MS)
  const visibility = useDocumentVisibility()
  const active = computed(() => !idle.value && visibility.value === "visible")

  const room = shallowRef<RealtimeRoom>()
  const tick = ref(0)
  const notices = ref(0)
  let generation = 0
  function leave() {
    generation++
    room.value?.destroy()
    room.value = undefined
  }

  watch(
    () => (mounted.value && config.public.realtime && me.value && options.enabled() ? drop.value.id : null),
    async (id) => {
      leave()
      const current = generation
      if (!id || !me.value) return
      const found = await $fetch<{ room: string }>(`/api/drops/${id}/presence`).catch((error: unknown) => {
        reportClientError("presence", error, { drop: id })
        return null
      })
      if (!found || current !== generation) return
      const { connectRealtimeRoom } = await import("vite-hub/realtime/client")
      if (current !== generation) return
      const joined = connectRealtimeRoom("presence", found.room, {
        params: { drop: id },
        identity: { id: me.value.id, name: me.value.name, ...(me.value.image ? { image: me.value.image } : {}) },
      })
      joined.setLocal("active", active.value)
      joined.setLocal("at", options.at())
      joined.onUpdate(() => tick.value++)
      joined.onNotice(() => notices.value++)
      room.value = joined
    },
    { immediate: true },
  )
  onScopeDispose(leave)
  watch(active, (value) => room.value?.setLocal("active", value))
  watch(options.at, (value) => {
    room.value?.setLocal("at", value)
    room.value?.setLocal("cursor", null)
  })

  const people = computed<PresencePerson[]>(() => {
    void tick.value
    const current = room.value
    if (!current) return []
    const states = current.states()
    const byId = new Map<string, PresencePerson>()
    for (const person of current.people()) {
      if (person.clientId === current.clientId || person.id === me.value?.id) continue
      const state = stateOf(states.get(person.clientId))
      if (state.active === false || byId.has(person.id)) continue
      byId.set(person.id, {
        id: person.id,
        name: person.name,
        ...(person.image ? { image: person.image } : {}),
        color: person.color,
        at: state.at ?? null,
      })
    }
    return [...byId.values()]
  })

  const cursors = computed<PresenceCursor[]>(() => {
    void tick.value
    const current = room.value
    if (!current || !showCursors.value) return []
    const here = options.at()
    const list: PresenceCursor[] = []
    const byClient = new Map(current.people().map((person) => [person.clientId, person]))
    for (const [clientId, raw] of current.states()) {
      const person = byClient.get(clientId)
      const { at, cursor } = stateOf(raw)
      if (!person || person.id === me.value?.id || (at ?? null) !== here || !cursor) continue
      list.push({ key: String(clientId), name: person.name, color: person.color, ...cursor })
    }
    return list
  })

  const sharing = computed(() => people.value.length > 0)

  function point(spot: Spot | null) {
    if (room.value && (sharing.value || spot === null)) room.value.setLocal("cursor", spot)
  }

  function commented() {
    room.value?.setLocal("comments", crypto.randomUUID())
  }

  const commentsChange = computed(() => {
    void tick.value
    const current = room.value
    if (!current) return ""
    return [...current.states().values()].map((state) => stateOf(state).comments ?? "").join()
  })

  return { people, cursors, sharing, showCursors, point, activity, commented, commentsChange, notices }
}

export type Presence = ReturnType<typeof usePresence>
