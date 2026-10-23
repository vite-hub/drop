<script setup lang="ts">
// Version 2 of a plan beside version 1, with the History panel: the docs' history screenshot, drawn in HTML so it stays
// sharp at any size and follows the color mode.
const DIFF = [
  { skip: "5 unchanged lines" },
  { text: "1. Move internal accounts first, the week of Nov 3." },
  { text: "2. Then 10% of teams, then everyone by Nov 24." },
  { text: "3. Freeze plan changes on Nov 2.", change: "+" },
  { skip: "5 unchanged lines" },
  { text: "- Invoices may double-send.", change: "-" },
  { text: "- Invoices may double-send during the switch. Pause the invoice job.", change: "+" },
  { text: "- Annual plans renew on the old price." },
] as const

const VERSIONS = [
  {
    v: "v2",
    note: "Freeze date, and pause the invoice job",
    meta: "Sam Rivera · 5 min. ago · 3 comments",
    current: true,
  },
  { v: "v1", note: "First draft from the pricing notes", meta: "Sam Rivera · 1 h. ago · 1 comment", current: false },
]
</script>

<template>
  <div
    aria-hidden="true"
    class="overflow-hidden rounded-xl border border-default bg-default text-highlighted shadow-xl shadow-black/5 select-none"
  >
    <div class="flex h-10 items-center gap-2 border-b border-default px-4 text-[13px]">
      <UIcon name="i-mingcute-arrow-left-line" class="size-4 text-muted" />
      <span class="text-muted">Plans</span><UIcon name="i-mingcute-right-line" class="size-3 text-dimmed" />
      <span class="font-medium">Billing migration</span>
      <span class="ml-auto flex items-center gap-3 text-muted">
        <UIcon name="i-mingcute-chat-1-line" class="size-4" />
        <span class="grid size-6 place-items-center rounded-md bg-elevated text-highlighted"
          ><UIcon name="i-mingcute-history-line" class="size-4"
        /></span>
        <span class="flex items-center gap-1 text-xs text-highlighted"
          ><UIcon name="i-mingcute-group-2-line" class="size-3.5" /> Team can edit</span
        >
      </span>
    </div>

    <div class="grid grid-cols-[minmax(0,1fr)_13rem]">
      <div class="min-w-0">
        <p class="flex items-center gap-1.5 border-b border-default px-4 py-2 text-xs text-muted">
          <span class="font-semibold text-highlighted">v2</span> vs v1
          <span class="text-emerald-600 dark:text-emerald-400">+2</span>
          <span class="text-red-600 dark:text-red-400">−1</span>
        </p>
        <div class="p-3">
          <div class="overflow-hidden rounded-md border border-default font-mono text-[10.5px] leading-6">
            <template v-for="(row, i) in DIFF" :key="i">
              <p v-if="'skip' in row" class="border-y border-default bg-muted px-3 text-dimmed first:border-t-0">
                {{ row.skip }}
              </p>
              <p
                v-else
                class="flex gap-2 truncate px-3"
                :class="
                  'change' in row
                    ? row.change === '+'
                      ? 'bg-emerald-50 dark:bg-emerald-400/10'
                      : 'bg-red-50 text-muted line-through dark:bg-red-400/10'
                    : ''
                "
              >
                <span class="w-2 shrink-0 text-dimmed no-underline">{{ "change" in row ? row.change : "" }}</span
                >{{ row.text }}
              </p>
            </template>
          </div>
        </div>
      </div>

      <aside class="border-l border-default p-2">
        <p class="flex gap-1 rounded-md bg-muted p-0.5 text-[11px]">
          <span class="px-2 py-0.5 text-muted">Comments</span>
          <span class="rounded-[5px] bg-default px-2 py-0.5 font-medium shadow-xs">History</span>
        </p>
        <div class="mt-2 space-y-1">
          <div
            v-for="version in VERSIONS"
            :key="version.v"
            class="rounded-md p-2"
            :class="version.current && 'bg-muted'"
          >
            <p class="flex items-center gap-1.5 text-[10px] text-muted">
              <span class="size-1.5 rounded-full" :class="version.current ? 'bg-inverted' : 'bg-accented'" />
              {{ version.v }}
              <span v-if="version.current" class="font-medium text-highlighted">Viewing</span>
            </p>
            <p class="mt-1 text-xs leading-snug">{{ version.note }}</p>
            <p class="mt-1 text-[10px] text-dimmed">{{ version.meta }}</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
