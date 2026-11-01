<script setup lang="ts">
// A video file, played with media-chrome's controls themed with Drop's shadcn tokens: Kibo UI's Video Player
// (kibo-ui.com/components/video-player), as Vue. The elements register on the client; until then the video sits there
// without controls.
defineProps<{ src: string; type?: string; title: string }>()

onMounted(() => import("media-chrome"))

// Firefox suspends decoding for a video whose window is hidden (behind another app, say), and on macOS a paused one can
// come back without its frame: the player showed nothing, the whole screen in fullscreen. Seeking to where the video
// already is decodes that frame again.
const video = useTemplateRef<HTMLVideoElement>("video")
const visibility = useDocumentVisibility()
watch(visibility, (state) => {
  const element = video.value
  if (state !== "visible" || !element?.paused || element.readyState < HTMLMediaElement.HAVE_METADATA) return
  const at = element.currentTime
  element.currentTime = at
})

const variables = {
  "--media-primary-color": "var(--primary)",
  "--media-secondary-color": "var(--background)",
  "--media-text-color": "var(--foreground)",
  "--media-control-hover-background": "var(--accent)",
  "--media-font-family": "var(--font-sans)",
  "--media-range-track-background": "var(--border)",
}
</script>

<template>
  <!-- The stage runs under the review dock and keeps the dock's height clear at its bottom, so the controls stay clickable. -->
  <div class="flex min-h-0 flex-1 flex-col bg-elevated px-4 pt-4 pb-28 sm:px-8 sm:pt-8 sm:pb-20">
    <!-- A size container: the video's height cap below is this box's height less the control bars (one row from @2xl). -->
    <div class="grid min-h-0 flex-1 place-items-center [container-type:size]">
      <!-- The stage caps the video's height and fills the letterbox with the page; fullscreen fills the screen, letterboxed in black. -->
      <media-controller
        class="@container block max-h-full w-full max-w-7xl overflow-hidden rounded-lg border border-default shadow-lg [--media-background-color:var(--background)] [&[mediaisfullscreen]]:rounded-none [&[mediaisfullscreen]]:border-0 [&[mediaisfullscreen]]:[--media-background-color:#000]"
        :style="variables"
      >
        <video
          ref="video"
          slot="media"
          class="block max-h-[calc(100cqh-5.5rem)] w-full @2xl:max-h-[calc(100cqh-2.75rem)] in-[[mediaisfullscreen]]:h-full in-[[mediaisfullscreen]]:max-h-none!"
          :aria-label="title"
          playsinline
          preload="metadata"
        >
          <source :src="src" :type="type" />
        </video>
        <!-- A narrow player can't fit the seek bar beside its buttons, so it gets a row of its own above them. -->
        <media-control-bar class="w-full @2xl:hidden">
          <media-time-range class="flex-1 px-2.5" />
        </media-control-bar>
        <media-control-bar class="w-full">
          <media-play-button class="p-2.5" />
          <media-seek-backward-button class="hidden p-2.5 @md:inline-flex" seekoffset="10" />
          <media-seek-forward-button class="hidden p-2.5 @md:inline-flex" seekoffset="10" />
          <media-time-range class="hidden flex-1 p-2.5 @2xl:inline-flex" />
          <media-time-display class="mr-auto p-2.5 font-mono tabular-nums @2xl:mr-0" showduration />
          <media-mute-button class="p-2.5" />
          <media-volume-range class="hidden p-2.5 @2xl:inline-flex" />
          <media-playback-rate-button class="p-2.5" />
          <media-fullscreen-button class="p-2.5" />
        </media-control-bar>
      </media-controller>
    </div>
  </div>
</template>
