<script setup lang="ts">
// How long the drop lives, for the people who manage it: pick a lifetime, renew it, or restore it from the Trash.
import { expiryLabel, type Lifetime, lifetimeDays } from "#shared/expiry"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const { data: me } = useMe()
const { setLifetime, restore } = useDropActions()
const notify = useNotify()
const now = useRelativeNow()
const days = computed(() => me.value?.expiry.days ?? 0)
const status = computed(() => expiryLabel(props.drop, now.value))
const trashed = computed(() => props.drop.trashedAt !== null)
/** Owners keep drops unless the admin turned that off; admins always may. */
const canKeep = computed(() => Boolean(me.value && (me.value.expiry.custom || me.value.role === "admin")))
const options = computed(() => [
  { label: "Temporary", value: "temporary", description: `${lifetimeDays("temporary", days.value)} days after the last visit` },
  { label: "Review", value: "review", description: `${days.value} days after the last visit` },
  { label: "Keep", value: "keep", description: "Until you delete it", disabled: !canKeep.value && props.drop.lifetime !== "keep" },
])
const hint = computed(() => {
  if (trashed.value) return props.drop.trashReason === "expired" ? "Nobody opened it for a while. Restore it to bring the link back." : "Restore it to bring the link back."
  if (props.drop.lifetime === "keep") return props.drop.keepReason ? `Kept by an agent: ${props.drop.keepReason}` : "Kept until you delete it."
  return `Any visit restarts the ${lifetimeDays(props.drop.lifetime, days.value)} days.`
})
const busy = ref(false)

async function run(action: () => Promise<boolean>, done?: string) {
  busy.value = true
  if (await action() && done) notify.done(done)
  busy.value = false
}
const choose = (lifetime: Lifetime) => run(() => setLifetime(props.drop, { lifetime }), `Lifetime: ${lifetime}`)
</script>

<template>
  <section v-if="days > 0" class="space-y-3">
    <h3 class="label-mono">Lifetime</h3>
    <div class="flex items-center gap-3">
      <span class="grid size-8 shrink-0 place-items-center rounded-full bg-elevated text-muted">
        <UIcon :name="trashed ? 'i-lucide-trash' : drop.lifetime === 'keep' ? 'i-lucide-infinity' : 'i-lucide-clock'" class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm text-highlighted">{{ status }}</p>
        <p class="text-xs text-muted">{{ hint }}</p>
      </div>
      <UButton v-if="trashed" color="neutral" label="Restore" :loading="busy" size="sm" variant="outline" @click="run(() => restore(drop))" />
      <UButton v-else-if="drop.lifetime !== 'keep'" color="neutral" label="Renew" :loading="busy" size="sm" variant="ghost" @click="run(() => setLifetime(drop, { renew: true }), 'Renewed')" />
    </div>
    <URadioGroup
      v-if="!trashed"
      color="neutral"
      :disabled="busy"
      indicator="hidden"
      :items="options"
      :model-value="drop.lifetime"
      size="sm"
      variant="card"
      @update:model-value="value => choose(value as Lifetime)"
    />
  </section>
</template>
