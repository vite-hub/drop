<script setup lang="ts">
// The reviews that cover a page, in the connect popup when there are several: each with its owner, so people pick the
// right one. `pending` is the choice being connected.
defineProps<{
  sites: Array<{ choice: string; title: string; owner: string; address: string }>
  pending: string | null
}>()
defineEmits<{ pick: [site: { choice: string; title: string; owner: string; address: string }] }>()
</script>

<template>
  <ul class="divide-y divide-default overflow-hidden rounded-lg border border-default">
    <li v-for="site in sites" :key="site.choice">
      <button
        class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-60"
        :disabled="pending !== null"
        type="button"
        @click="$emit('pick', site)"
      >
        <UIcon name="i-mingcute-world-2-line" class="size-4 shrink-0 text-muted" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-highlighted">{{ site.title }}</span>
          <span class="block truncate text-xs text-muted"
            >{{ site.owner || "Unknown owner" }} ·
            <span class="font-mono">{{ site.address.replace(/^https?:\/\//, "") }}</span></span
          >
        </span>
        <UIcon
          v-if="pending === site.choice"
          name="i-mingcute-loading-line"
          class="size-4 shrink-0 animate-spin text-muted"
        />
        <UIcon v-else name="i-mingcute-right-line" class="size-4 shrink-0 text-dimmed" />
      </button>
    </li>
  </ul>
</template>
