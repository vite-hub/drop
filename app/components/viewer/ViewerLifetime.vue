<script setup lang="ts">
// How long the drop lives, for the people who manage it: renew it, keep it forever, or answer an agent that asked to.
import { expiryLabel } from "#shared/expiry"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const { data: me } = useMe()
const { setExpiry } = useDropActions()
const notify = useNotify()
const now = useRelativeNow()
const days = computed(() => me.value?.expiry.days ?? 0)
const status = computed(() => expiryLabel(props.drop, now.value))
const expired = computed(() => props.drop.expiresAt !== null && props.drop.expiresAt <= now.value)
const hint = computed(() => props.drop.neverExpires ? "Kept until you delete it." : expired.value ? "Renew it to bring the link back." : `Any visit restarts the ${days.value} days.`)
/** Owners may opt out unless the admin turned that off; admins always may. */
const canKeepForever = computed(() => Boolean(me.value && (me.value.expiry.custom || me.value.role === "admin")))
const busy = ref(false)

async function run(change: { neverExpires?: boolean; renew?: true }, done: string) {
  busy.value = true
  if (await setExpiry(props.drop, change)) notify.done(done)
  busy.value = false
}
</script>

<template>
  <section v-if="days > 0" class="space-y-3">
    <h3 class="label-mono">Lifetime</h3>
    <div class="flex items-center gap-3">
      <span class="grid size-8 shrink-0 place-items-center rounded-full bg-elevated text-muted">
        <UIcon :name="drop.neverExpires ? 'i-lucide-infinity' : 'i-lucide-clock'" class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm text-highlighted">{{ status }}</p>
        <p class="text-xs text-muted">{{ hint }}</p>
      </div>
      <UButton v-if="!drop.neverExpires" color="neutral" label="Renew" :loading="busy" size="sm" variant="ghost" @click="run({ renew: true }, `Renewed for ${days} days`)" />
    </div>

    <div v-if="drop.neverExpiresRequest && !drop.neverExpires" class="rounded-lg border border-default p-3">
      <p class="text-sm"><span class="font-medium text-highlighted">{{ drop.neverExpiresRequest }}</span> <span class="text-muted">asked to keep this drop forever.</span></p>
      <div class="mt-2.5 flex gap-2">
        <UButton v-if="canKeepForever" color="neutral" label="Keep Forever" :loading="busy" size="sm" @click="run({ neverExpires: true }, 'Kept forever')" />
        <UButton color="neutral" label="Dismiss" size="sm" variant="outline" :disabled="busy" @click="run({ neverExpires: false }, 'Request dismissed')" />
      </div>
      <p v-if="!canKeepForever" class="mt-2 text-xs text-muted">Only an admin can keep drops forever on this Drop.</p>
    </div>

    <label v-if="canKeepForever" class="flex items-center justify-between gap-3">
      <span class="text-[13px]" :class="drop.neverExpires ? 'text-highlighted' : 'text-muted'">Keep forever</span>
      <USwitch
        color="neutral"
        :disabled="busy"
        :model-value="drop.neverExpires"
        @update:model-value="value => run({ neverExpires: value }, value ? 'Kept forever' : `Expires after ${days} days without visits`)"
      />
    </label>
  </section>
</template>
