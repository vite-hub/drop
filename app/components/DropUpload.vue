<script setup lang="ts">
// A file on its way up (PendingUpload), drawn where its drop will land: a card on the Drops page's grid, a line in its
// list, or a row in a folder. An image or a video shows itself at once from the reader's own copy. The bar and the
// percentage say how much has gone; at 100% the server still stores it, so it says "Saving" until the drop is in.
import type { PendingUpload } from "~/composables/useUploads"

const { upload, layout } = defineProps<{ upload: PendingUpload; layout: "card" | "line" | "row" }>()
const percent = computed(() => (upload.progress === null ? null : Math.round(upload.progress * 100)))
const status = computed(() =>
  percent.value === null ? "Waiting" : percent.value >= 100 ? "Saving" : `${percent.value}%`,
)
const video = computed(() => upload.type.startsWith("video/"))
const icon = computed(() =>
  upload.type.startsWith("image/") ? KIND_ICONS.image : video.value ? "i-mingcute-video-line" : KIND_ICONS.file,
)
</script>

<template>
  <li
    :aria-label="`Uploading ${upload.name}`"
    :aria-valuenow="percent ?? undefined"
    aria-valuemax="100"
    aria-valuemin="0"
    :aria-valuetext="status"
    :class="layout === 'card' ? 'relative' : 'relative flex min-w-0 items-center gap-3'"
    role="progressbar"
  >
    <template v-if="layout === 'card'">
      <div
        class="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted shadow-[0_0_0_1px_rgb(0_0_0/.07),0_1px_2px_rgb(0_0_0/.05)] dark:shadow-[0_0_0_1px_rgb(255_255_255/.09)]"
      >
        <video v-if="upload.preview && video" class="size-full object-cover opacity-60" muted :src="upload.preview" />
        <img
          v-else-if="upload.preview"
          alt=""
          class="size-full object-cover object-top opacity-60"
          :src="upload.preview"
        />
        <div v-else class="grid size-full place-items-center">
          <UIcon :name="icon" class="size-8 text-dimmed" />
        </div>
        <span
          class="absolute right-2 bottom-3 rounded-full bg-black/70 px-2 font-mono text-[11px] leading-5 text-white tabular-nums backdrop-blur-sm"
          >{{ status }}</span
        >
        <span class="absolute inset-x-0 bottom-0 h-1 bg-black/10 dark:bg-white/10">
          <span
            class="block h-full bg-inverted transition-[width] duration-200 ease-out"
            :style="{ width: `${percent ?? 0}%` }"
          />
        </span>
      </div>
      <div class="mt-2.5 flex min-w-0 items-center gap-1.5 px-0.5">
        <UIcon :name="icon" class="size-3.5 shrink-0 text-muted" />
        <span class="truncate text-sm font-medium text-muted">{{ upload.name }}</span>
      </div>
      <p class="mt-0.5 px-0.5 text-xs text-muted">Uploading</p>
    </template>
    <template v-else>
      <span
        class="grid shrink-0 place-items-center overflow-hidden"
        :class="layout === 'row' ? 'size-7 rounded-md' : 'size-4 rounded-[3px]'"
      >
        <img
          v-if="upload.preview && !video"
          alt=""
          class="size-full object-cover object-top opacity-60"
          :src="upload.preview"
        />
        <UIcon v-else :name="icon" class="size-4 text-muted" />
      </span>
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-muted">{{ upload.name }}</span>
      <span class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-accented">
        <span
          class="block h-full rounded-full bg-inverted transition-[width] duration-200 ease-out"
          :style="{ width: `${percent ?? 0}%` }"
        />
      </span>
      <span class="w-14 shrink-0 text-right text-xs text-muted tabular-nums">{{ status }}</span>
    </template>
  </li>
</template>
