<script setup lang="ts">
// The lifetime as a chip in the review pill's + row, left of the version: "30 d", or ∞ "Forever". One click opens the
// choices. A drop in a folder lives as long as the folder at the top, so there the choice changes that folder, and the
// menu says so. Opening a drop restarts its count, so the chip shows the window, never a countdown. A trashed drop has
// the page's Restore banner instead.
import { type Lifetime, lifetimeDays, lifetimeLabel, LIFETIMES } from "#shared/expiry"
import type { DropDetail } from "#shared/types"
import type { DropdownMenuItem } from "@nuxt/ui"

const props = defineProps<{ drop: DropDetail }>()
const { data: me } = useMe()
const { setLifetime } = useDropActions()
const notify = useNotify()
const days = computed(() => me.value?.expiry.days ?? 0)
/** The folder at the top decides for everything in it. */
const folder = computed(() => (props.drop.parentId ? props.drop.ancestors[0] : undefined))
const current = computed<Lifetime>(() => (props.drop.expiresAt === null ? "keep" : props.drop.lifetime))
const span = computed(() => lifetimeDays(current.value, days.value))
const label = computed(() => (span.value ? `${span.value} d` : "Forever"))
/** Owners keep drops unless the admin turned that off; admins always may. */
const canKeep = computed(() => Boolean(me.value && (me.value.expiry.custom || me.value.role === "admin")))
// A team folder never expires and nothing in it can change that.
const fixed = computed(() => props.drop.teamFolder)
const busy = ref(false)

async function run(change: { lifetime?: Lifetime; renew?: true }, done?: string) {
  busy.value = true
  const target = folder.value ?? props.drop
  const ok = await setLifetime(target, change)
  if (ok && folder.value) await refreshNuxtData(keys.drop(props.drop.id))
  if (ok && done) notify.done(done)
  busy.value = false
}

const items = computed<DropdownMenuItem[][]>(() => [
  [
    {
      type: "label",
      // Labels truncate by default; this one is a sentence, so it wraps.
      ui: { label: "font-normal text-muted", itemLabel: "whitespace-normal text-pretty" },
      label: folder.value ? `Set on its folder, ${folder.value.title}` : "Goes to the Trash when nobody opens it for",
    },
    ...LIFETIMES.map((value) => ({
      type: "checkbox" as const,
      label: lifetimeLabel(value, days.value),
      checked: current.value === value,
      disabled: busy.value || (value === "keep" && !canKeep.value && current.value !== "keep"),
      onSelect: () => current.value !== value && void run({ lifetime: value }),
    })),
  ],
  ...(span.value
    ? [
        [
          {
            label: `Reset to ${lifetimeLabel(current.value, days.value)}`,
            icon: "i-mingcute-refresh-2-line",
            disabled: busy.value,
            onSelect: () => void run({ renew: true }, "Count restarted"),
          },
        ],
      ]
    : []),
])
const chip =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-toned tabular-nums transition-colors hover:bg-elevated hover:text-highlighted aria-expanded:bg-inverted aria-expanded:text-inverted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96 motion-reduce:active:scale-100"
</script>

<template>
  <span v-if="fixed" :class="[chip, 'pointer-events-none']" aria-label="Lifetime: forever">
    <!-- MingCute has no infinity sign; this one is drawn at its 1.75 stroke. -->
    <svg
      aria-hidden="true"
      class="size-3.5"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="1.75"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 12c-2-2.7-3.6-4-5.3-4a4 4 0 0 0 0 8c1.7 0 3.3-1.3 5.3-4m0 0c2 2.7 3.6 4 5.3 4a4 4 0 0 0 0-8c-1.7 0-3.3 1.3-5.3 4"
      /></svg
    >Forever
  </span>
  <UDropdownMenu
    v-else-if="days > 0"
    :content="{ side: 'top', sideOffset: 10 }"
    :items="items"
    :ui="{ content: 'w-64' }"
  >
    <button :aria-label="`Lifetime: ${lifetimeLabel(current, days)}`" :class="chip" type="button">
      <UIcon v-if="span" name="i-mingcute-time-line" class="size-3.5" />
      <svg
        v-else
        aria-hidden="true"
        class="size-3.5"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.75"
        viewBox="0 0 24 24"
      >
        <path
          d="M12 12c-2-2.7-3.6-4-5.3-4a4 4 0 0 0 0 8c1.7 0 3.3-1.3 5.3-4m0 0c2 2.7 3.6 4 5.3 4a4 4 0 0 0 0-8c-1.7 0-3.3 1.3-5.3 4"
        /></svg
      >{{ label }}
    </button>
  </UDropdownMenu>
</template>
