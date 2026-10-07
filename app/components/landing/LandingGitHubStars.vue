<script setup lang="ts">
// Header GitHub link with the live star count. The count stays hidden until it loads, and on failure.
const stars = ref<number | null>(null)

onMounted(async () => {
  try {
    const response = await fetch("https://api.github.com/repos/vite-hub/drop")
    const repo = response.ok ? ((await response.json()) as { stargazers_count?: number }) : null
    stars.value = typeof repo?.stargazers_count === "number" ? repo.stargazers_count : null
  } catch {
    stars.value = null
  }
})

const label = computed(() => (stars.value === null ? "" : stars.value >= 1000 ? `${(stars.value / 1000).toFixed(1)}k` : String(stars.value)))
</script>

<template>
  <a
    aria-label="Drop on GitHub"
    class="group ml-1 inline-flex h-8 items-center overflow-hidden rounded-md border border-default text-[13px] font-medium text-highlighted transition-colors hover:bg-elevated"
    href="https://github.com/vite-hub/drop"
    rel="noreferrer"
    target="_blank"
  >
    <span class="flex items-center gap-1.5 px-2.5">
      <UIcon name="i-simple-icons-github" class="size-4" />
      <span class="hidden sm:inline">GitHub</span>
    </span>
    <span v-if="stars !== null" class="flex h-full items-center gap-1 border-l border-default px-2.5 text-muted tabular-nums">
      <svg aria-hidden="true" class="size-3.5 transition-colors group-hover:fill-current group-hover:text-[#e3b341]" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
        <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
      </svg>
      {{ label }}
    </span>
  </a>
</template>
