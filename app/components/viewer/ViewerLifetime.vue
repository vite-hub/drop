<script setup lang="ts">
// The lifetime as a chip in the review pill's + row, left of the version: "30 d", or ∞ "Forever". One click opens the
// choices (useLifetime, which the ⌘K palette offers too). A drop in a folder lives as long as the folder at the top, so
// there the choice changes that folder, and the menu says so. Opening a drop restarts its count, so the chip shows the
// window, never a countdown. A trashed drop has the page's Restore banner instead.
import { lifetimeLabel } from "#shared/expiry"
import type { DropDetail } from "#shared/types"
import type { DropdownMenuItem } from "@nuxt/ui"

const props = defineProps<{ drop: DropDetail }>()
const { days, folder, current, span, fixed, choices, reset } = useLifetime(() => props.drop)
const label = computed(() => (span.value ? `${span.value} d` : "Forever"))

const items = computed<DropdownMenuItem[][]>(() => [
  [
    {
      type: "label",
      // Labels truncate by default; this one is a sentence, so it wraps.
      ui: { label: "font-normal text-muted", itemLabel: "whitespace-normal text-pretty" },
      label: folder.value ? `Set on its folder, ${folder.value.title}` : "Goes to the Trash when nobody opens it for",
    },
    ...choices.value.map((choice) => ({
      type: "checkbox" as const,
      label: choice.label,
      checked: choice.on,
      disabled: choice.disabled,
      onSelect: choice.select,
    })),
  ],
  ...(reset.value
    ? [
        [
          {
            label: reset.value.label,
            icon: "i-mingcute-refresh-2-line",
            disabled: reset.value.disabled,
            onSelect: reset.value.select,
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
