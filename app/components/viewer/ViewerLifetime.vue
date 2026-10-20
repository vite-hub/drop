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
const busy = ref(false)
const options = computed(() => [
  { label: "Temporary", value: "temporary", disabled: busy.value },
  { label: "Review", value: "review", disabled: busy.value },
  { label: "Keep", value: "keep", disabled: busy.value || (!canKeep.value && props.drop.lifetime !== "keep") },
])
const hint = computed(() => {
  if (trashed.value)
    return props.drop.trashReason === "expired"
      ? "Nobody opened it for a while. Restore it to bring the link back."
      : "Restore it to bring the link back."
  if (props.drop.lifetime === "keep")
    return props.drop.keepReason ? `Kept by an agent: ${props.drop.keepReason}` : "Kept until you delete it."
  return `Gone ${lifetimeDays(props.drop.lifetime, days.value)} days after the last visit. Any visit restarts the count.`
})
// A quiet segmented control. The trigger's `before:` classes style the selected item until hydration adds the indicator.
const tabsUi = {
  list: "w-full",
  indicator: "bg-default shadow-xs ring ring-default",
  trigger:
    "flex-1 justify-center data-[state=active]:text-highlighted in-[[data-slot=list]:not(:has([data-slot=indicator]))]:data-[state=active]:before:bg-default in-[[data-slot=list]:not(:has([data-slot=indicator]))]:data-[state=active]:before:ring in-[[data-slot=list]:not(:has([data-slot=indicator]))]:data-[state=active]:before:ring-default",
}

async function run(action: () => Promise<boolean>, done?: string) {
  busy.value = true
  if ((await action()) && done) notify.done(done)
  busy.value = false
}
// The control shows the new lifetime; renewing, which may not change what it says, gets a toast.
const choose = (lifetime: Lifetime) => run(() => setLifetime(props.drop, { lifetime }))
</script>

<template>
  <section v-if="days > 0" class="space-y-2.5 text-sm">
    <div class="flex items-center gap-3">
      <h3 class="w-20 shrink-0 text-muted">Lifetime</h3>
      <p class="min-w-0 flex-1 truncate text-highlighted tabular-nums">{{ status }}</p>
      <UButton
        v-if="trashed"
        class="-my-1"
        color="neutral"
        label="Restore"
        :loading="busy"
        size="xs"
        variant="outline"
        @click="run(() => restore(drop))"
      />
      <UButton
        v-else-if="drop.lifetime !== 'keep'"
        class="-my-1"
        color="neutral"
        label="Renew"
        :loading="busy"
        size="xs"
        variant="ghost"
        @click="run(() => setLifetime(drop, { renew: true }), 'Renewed')"
      />
    </div>
    <UTabs
      v-if="!trashed"
      color="neutral"
      :content="false"
      :items="options"
      :model-value="drop.lifetime"
      size="xs"
      :ui="tabsUi"
      @update:model-value="(value) => choose(value as Lifetime)"
    />
    <p class="text-xs text-pretty text-muted">{{ hint }}</p>
  </section>
</template>
