import type { DropDetail } from "#shared/types"
import type { RealtimeRoom } from "@vite-hub/realtime/client"
import * as v from "valibot"

/** Someone else with the drop open: who, in their presence color, whether they're away, and where they are. */
export interface PresencePerson {
  id: string
  name: string
  image?: string
  color: string
  /** Away: no input for a minute, or their tab is hidden. */
  idle: boolean
  /** Where they are: a doc's version (`v3`, an app's page after it), a reviewed site's page, or null in Drop. */
  at: string | null
}

/** Another person's pointer, said as the element under it and the spot inside it (PRESENCE_CURSORS). */
export interface PresenceCursor {
  key: string
  name: string
  color: string
  selector: string
  x: number
  y: number
}

/**
 * What one person shares in the room's awareness, as this app's clients set it: anyone in the room can send anything,
 * so each state is parsed here, and a field that doesn't fit counts as unset.
 */
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

/**
 * Who else has a drop open right now, through its presence room (server/realtime/presence.ts), and their cursors on the
 * page this reader is on. Only people who could open the drop without its link join, so the room's name comes from
 * the server, which answers nobody else; a stranger on a public link never joins and never shows. The Realtime client
 * loads once the page shows. Run in a component's setup: leaving it leaves the room.
 *
 * `at` says where this reader is, so only the people on the same version or page see each other's cursors.
 */
export function usePresence(drop: Ref<DropDetail>, options: { at: () => string | null; enabled: () => boolean }) {
  const config = useRuntimeConfig()
  const { data: me } = useMe()
  const mounted = useMounted()
  const showCursors = useLocalStorage("drop-presence-cursors", true)
  const { idle } = useIdle(IDLE_MS)
  const visibility = useDocumentVisibility()
  const active = computed(() => !idle.value && visibility.value === "visible")

  const room = shallowRef<RealtimeRoom>()
  // RealtimeRoom isn't reactive: each update bumps this, and what reads the room reads it first.
  const tick = ref(0)
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
      const found = await $fetch<{ room: string }>(`/api/drops/${id}/presence`).catch(() => null)
      if (!found || current !== generation) return
      const { connectRealtimeRoom } = await import("@vite-hub/realtime/client")
      if (current !== generation) return
      const joined = connectRealtimeRoom("presence", found.room, {
        params: { drop: id },
        identity: { id: me.value.id, name: me.value.name, ...(me.value.image ? { image: me.value.image } : {}) },
      })
      joined.setLocal("active", active.value)
      joined.setLocal("at", options.at())
      joined.onUpdate(() => tick.value++)
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

  /** Everyone else in the room, each person once, their tabs together: away only when every tab of theirs is. */
  const people = computed<PresencePerson[]>(() => {
    void tick.value
    const current = room.value
    if (!current) return []
    const states = current.states()
    const byId = new Map<string, PresencePerson>()
    for (const person of current.people()) {
      if (person.clientId === current.clientId || person.id === me.value?.id) continue
      const state = stateOf(states.get(person.clientId))
      const entry: PresencePerson = {
        id: person.id,
        name: person.name,
        ...(person.image ? { image: person.image } : {}),
        color: person.color,
        idle: state.active === false,
        at: state.at ?? null,
      }
      const seen = byId.get(person.id)
      if (!seen || (seen.idle && !entry.idle)) byId.set(person.id, entry)
    }
    return [...byId.values()]
  })

  /** The cursors of the people on this reader's version or page, unless they hid cursors. */
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

  /** Whether this reader's pointer goes out: only while someone else is here to see it. */
  const sharing = computed(() => people.value.length > 0)

  /** Where this reader's pointer is, or null once it leaves the page. */
  function point(spot: Spot | null) {
    if (room.value && (sharing.value || spot === null)) room.value.setLocal("cursor", spot)
  }

  /** Tells the others the comments changed, so their lists load them now rather than on their next poll. */
  function commented() {
    room.value?.setLocal("comments", crypto.randomUUID())
  }

  /** Changes each time someone else says the comments changed. */
  const commentsChange = computed(() => {
    void tick.value
    const current = room.value
    if (!current) return ""
    return [...current.states().values()].map((state) => stateOf(state).comments ?? "").join()
  })

  return { people, cursors, sharing, showCursors, point, commented, commentsChange }
}

export type Presence = ReturnType<typeof usePresence>
