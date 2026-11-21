import type { DropDetail } from "#shared/types"
import type { EffectScope } from "vue"

export function useLatestVersion(
  drop: Ref<DropDetail>,
  options: { enabled: MaybeRefOrGetter<boolean>; busy: () => boolean },
) {
  const notify = useNotify()
  const config = useRuntimeConfig()
  const enabled = () => config.public.realtime && toValue(options.enabled)
  const room = shallowRef<Readonly<Ref<number>>>()
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
      const { useLatestRoom } = await import("~/composables/latest-room")
      if (current !== generation || !enabled()) {
        nextScope.stop()
        if (scope === nextScope) scope = undefined
        return
      }
      room.value = nextScope.run(() => useLatestRoom(() => drop.value.link, enabled))
    },
  )
  onScopeDispose(() => {
    generation++
    scope?.stop()
  })
  const latest = computed(() => room.value?.value ?? 0)

  const follow = () => refreshNuxtData([keys.dropLink(drop.value.link), keys.drop(drop.value.id)])

  const busy = computed(options.busy)
  let told = 0
  watch([latest, busy], ([version, waiting]) => {
    if (version <= drop.value.version) return
    if (!waiting) return void follow()
    if (told === version) return
    told = version
    notify.say(`v${version} was published`, {
      icon: "i-mingcute-history-line",
      action: { label: "Open", onClick: () => void follow() },
    })
  })
}
