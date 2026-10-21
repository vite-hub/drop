<script setup lang="ts">
// A drop's frame alone, filling its window: what More › Open in new window shows, for a projector or a second screen.
// It runs on the drop's own origin like the viewer's frame, so a deck's own presenter sync reaches it (Slidev's
// presenter view in the viewer drives this window over BroadcastChannel). No comments, no panel.
const state = injectDrop()!
const drop = computed(() => state.drop.data.value!)
const frame = useTemplateRef<HTMLIFrameElement>("frame")
const app = useAppFiles(drop)
// Presenting takes no comments: as in the editor, the frame's comment layer stays off.
const annotations = useViewerAnnotations({ drop, editing: ref(true), wide: ref(true), mobileSide: ref(false) })
const { srcdoc, contentOrigin, frameSrc, frameKey } = useViewerFrame({
  drop,
  frame,
  app,
  pinned: ref([]),
  inset: ref(0),
  annotations,
})
useSeoMeta({ title: () => drop.value.title })
</script>

<template>
  <div class="fixed inset-0 bg-default">
    <iframe
      v-if="contentOrigin"
      :key="frameKey"
      ref="frame"
      class="block size-full [color-scheme:light]"
      :allow="frameAllow(drop.kind)"
      :sandbox="CONTENT_SANDBOX"
      :src="frameSrc"
      :title="drop.title"
    />
    <!-- Hydration mismatch reason: server and client bundlers format srcdoc's embedded app resolver differently. -->
    <iframe
      v-else-if="srcdoc"
      ref="frame"
      class="block size-full [color-scheme:light]"
      data-allow-mismatch="attribute"
      :allow="frameAllow(drop.kind)"
      :sandbox="PREVIEW_SANDBOX"
      :srcdoc="srcdoc"
      :title="drop.title"
    />
  </div>
</template>
