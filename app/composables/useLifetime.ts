import { type Lifetime, lifetimeDays, lifetimeLabel, LIFETIMES } from "#shared/expiry"
import type { DropDetail } from "#shared/types"

export function useLifetime(drop: () => DropDetail) {
  const { data: me } = useMe()
  const { setLifetime } = useDropActions()
  const notify = useNotify()
  const days = computed(() => me.value?.expiry.days ?? 0)
  const folder = computed(() => (drop().parentId ? drop().ancestors[0] : undefined))
  const current = computed<Lifetime>(() => (drop().expiresAt === null ? "keep" : drop().lifetime))
  const span = computed(() => lifetimeDays(current.value, days.value))
  const canKeep = computed(() => Boolean(me.value && (me.value.expiry.custom || me.value.role === "admin")))
  const fixed = computed(() => drop().lifetimeFixed || drop().teamFolder)
  const choosable = computed(() => !fixed.value && days.value > 0)
  const busy = ref(false)

  async function run(change: { lifetime?: Lifetime; renew?: true }, done?: string) {
    busy.value = true
    const target = folder.value ?? drop()
    const ok = await setLifetime(target, change)
    if (ok && folder.value) await refreshNuxtData(keys.drop(drop().id))
    if (ok && done) notify.done(done)
    busy.value = false
  }

  const choices = computed(() =>
    LIFETIMES.map((value) => ({
      value,
      label: lifetimeLabel(value, days.value),
      on: current.value === value,
      disabled: busy.value || (value === "keep" && !canKeep.value && current.value !== "keep"),
      select: () => current.value !== value && void run({ lifetime: value }),
    })),
  )
  const reset = computed(() =>
    span.value
      ? {
          label: `Reset to ${lifetimeLabel(current.value, days.value)}`,
          disabled: busy.value,
          select: () => void run({ renew: true }, "Count restarted"),
        }
      : null,
  )

  return { days, folder, current, span, fixed, choosable, choices, reset }
}
