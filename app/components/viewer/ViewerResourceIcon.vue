<script setup lang="ts">
// A link's site icon: `/favicon.ico` on its host, then on the domains above it (faviconUrls), then a plain link icon.
// Loaded straight from the site with no referrer, so no icon service learns what the drop links to. Only once mounted:
// an image the server rendered can fail before the page hydrates, and its error would never reach the handler.
import { faviconUrls } from "#shared/resources"

// Sites whose favicon is a black mark, lost on the dark theme: their Simple Icons mark takes the text color instead.
const MARKS = { "github.com": "i-simple-icons-github" } satisfies Record<string, string>

const props = defineProps<{ url: string }>()
const mark = computed(() => {
  const hostname = new URL(props.url).hostname.replace(/^www\./, "")
  return MARKS[hostname as keyof typeof MARKS]
})
const tries = computed(() => faviconUrls(props.url))
const index = ref(0)
const mounted = useMounted()
watch(
  () => props.url,
  () => (index.value = 0),
)
</script>

<template>
  <UIcon v-if="mark" class="size-4 shrink-0 text-muted" :name="mark" />
  <span v-else-if="!mounted" class="size-4 shrink-0" />
  <img
    v-else-if="index < tries.length"
    :key="tries[index]"
    alt=""
    class="size-4 shrink-0 rounded-xs object-contain"
    decoding="async"
    referrerpolicy="no-referrer"
    :src="tries[index]"
    @error="index++"
  />
  <UIcon v-else class="size-4 shrink-0 text-muted" name="i-mingcute-link-line" />
</template>
