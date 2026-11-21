<script setup lang="ts">
import { faviconUrl } from "#shared/resources"

const props = defineProps<{ url: string }>()
const tries = computed(() => [faviconUrl(props.url)])
const index = ref(0)
const mounted = useMounted()
watch(
  () => props.url,
  () => (index.value = 0),
)
</script>

<template>
  <span v-if="!mounted" class="size-4 shrink-0" />
  <img
    v-else-if="index < tries.length"
    :key="tries[index]"
    alt=""
    class="size-4 shrink-0 rounded-xs object-contain dark:bg-white dark:ring-2 dark:ring-white"
    decoding="async"
    referrerpolicy="no-referrer"
    :src="tries[index]"
    @error="index++"
  />
  <span
    v-else
    class="grid size-4 shrink-0 place-items-center rounded-xs text-muted dark:bg-white dark:text-neutral-500 dark:ring-2 dark:ring-white"
  >
    <UIcon class="size-full" name="i-mingcute-link-line" />
  </span>
</template>
