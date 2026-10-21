import type { DropDetail } from "#shared/types"

/**
 * Follows a doc's link to its newest version while someone reads it. The link's Realtime room (server/realtime/latest.ts)
 * holds the version number of the doc's head, and publishing re-seeds it, so a new version arrives as soon as it's out.
 * A reader who isn't busy moves to it at once; a busy one (commenting, selecting, a dialog open) gets a toast, and moves
 * once done.
 */
export function useLatestVersion(
  drop: Ref<DropDetail>,
  options: { enabled: MaybeRefOrGetter<boolean>; busy: () => boolean },
) {
  const notify = useNotify()
  const config = useRuntimeConfig()
  const enabled = () => config.public.realtime && toValue(options.enabled)
  // The room loads once the page shows and following is on (~/utils/latest-room), in a scope of this component's.
  const room = shallowRef<ComputedRef<number>>()
  let scope: EffectScope | undefined
  let generation = 0
  const mounted = useMounted()
  watch(
    () => mounted.value && enabled(),
    async (on) => {
      const current = ++generation
      if (!on) {
        scope?.stop()
        scope = undefined
        room.value = undefined
        return
      }
      if (room.value || scope) return
      const nextScope = effectScope()
      scope = nextScope
      const { joinLatestRoom } = await import("~/utils/latest-room")
      if (current !== generation || !enabled()) {
        nextScope.stop()
        if (scope === nextScope) scope = undefined
        return
      }
      room.value = nextScope.run(() => joinLatestRoom(() => drop.value.link, enabled))
    },
  )
  onScopeDispose(() => {
    generation++
    scope?.stop()
  })
  const latest = computed(() => room.value?.value ?? 0)

  // The page loads the doc behind the link again: another version mounts a new viewer (both pages key it by id and
  // version), and an app, which keeps its id, gets its new files.
  const follow = () => refreshNuxtData([keys.dropLink(drop.value.link), keys.drop(drop.value.id)])

  // Busy readers hear about it once per version, and move as soon as they're done (the comment sent, the dialog closed).
  const busy = computed(options.busy)
  let told = 0
  watch([latest, busy], ([version, waiting]) => {
    if (version <= drop.value.version) return
    if (!waiting) return void follow()
    if (told === version) return
    told = version
    notify.info({
      title: `v${version} was published`,
      description: "It opens when you're done here.",
      icon: "i-mingcute-history-line",
      actions: [{ label: `Open v${version}`, color: "neutral", variant: "outline", onClick: () => void follow() }],
    })
  })
}
