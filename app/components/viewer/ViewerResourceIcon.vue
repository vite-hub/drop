<script setup lang="ts">
// A link's site icon: `/favicon.ico` on its host, then on the domains above it (faviconUrls), then a plain link icon.
// Loaded straight from the site with no referrer, so no icon service learns what the drop links to. Only once mounted:
// an image the server rendered can fail before the page hydrates, and its error would never reach the handler.
// Favicons are drawn for a light tab bar, and many (GitHub, Airtable, Vercel) are a black mark, so in the dark theme
// each sits on a light plate: a ring of the plate's color grows it 2px past the icon without moving the layout.
import { faviconUrls } from "#shared/resources"

const props = defineProps<{ url: string }>()
const tries = computed(() => faviconUrls(props.url))
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
  <!-- An icon font's glyph is a mask over its own fill, so the plate goes on a box around it. -->
  <span
    v-else
    class="grid size-4 shrink-0 place-items-center rounded-xs text-muted dark:bg-white dark:text-neutral-500 dark:ring-2 dark:ring-white"
  >
    <UIcon class="size-full" name="i-mingcute-link-line" />
  </span>
</template>
