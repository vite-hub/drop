<script setup lang="ts">
// A video file, played with media-chrome's controls themed with Drop's shadcn tokens: Kibo UI's Video Player
// (kibo-ui.com/components/video-player), as Vue. The elements register on the client; until then the video sits there
// without controls.
defineProps<{ src: string; type?: string; title: string }>()

onMounted(() => import("media-chrome"))

const variables = {
  "--media-primary-color": "var(--primary)",
  "--media-secondary-color": "var(--background)",
  "--media-text-color": "var(--foreground)",
  "--media-background-color": "var(--background)",
  "--media-control-hover-background": "var(--accent)",
  "--media-font-family": "var(--font-sans)",
  "--media-range-track-background": "var(--border)",
}
</script>

<template>
  <div class="grid min-h-0 flex-1 place-items-center bg-elevated p-6 sm:p-10">
    <media-controller
      class="block max-h-full w-full max-w-5xl overflow-hidden rounded-lg border border-default shadow-lg"
      :style="variables"
    >
      <video
        slot="media"
        class="block max-h-[calc(100dvh-12rem)] w-full"
        :aria-label="title"
        playsinline
        preload="metadata"
      >
        <source :src="src" :type="type" />
      </video>
      <media-control-bar class="w-full">
        <media-play-button class="p-2.5" />
        <media-seek-backward-button class="p-2.5" seekoffset="10" />
        <media-seek-forward-button class="p-2.5" seekoffset="10" />
        <media-time-range class="flex-1 p-2.5" />
        <media-time-display class="p-2.5 font-mono tabular-nums" showduration />
        <media-mute-button class="p-2.5" />
        <media-volume-range class="p-2.5" />
        <media-playback-rate-button class="p-2.5" />
        <media-fullscreen-button class="p-2.5" />
      </media-control-bar>
    </media-controller>
  </div>
</template>
