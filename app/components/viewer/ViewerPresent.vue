<script setup lang="ts">
const state = injectDrop()!
const drop = computed(() => state.drop.data.value!)
const frame = useTemplateRef<HTMLIFrameElement>("frame")
const app = useAppFiles(drop)
const annotations = useViewerAnnotations({ drop, editing: ref(true) })
const { srcdoc, contentOrigin, frameSrc, frameKey, frameScheme } = useViewerFrame({
  drop,
  frame,
  app,
  pinned: ref([]),
  inset: ref(0),
  bottom: ref(0),
  width: useDocWidth(),
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
      class="block size-full"
      :style="{ colorScheme: frameScheme }"
      :allow="frameAllow(drop.kind)"
      :sandbox="CONTENT_SANDBOX"
      :src="frameSrc"
      :title="drop.title"
    />
    <iframe
      v-else-if="srcdoc"
      ref="frame"
      class="block size-full"
      :style="{ colorScheme: frameScheme }"
      data-allow-mismatch="attribute"
      :allow="frameAllow(drop.kind)"
      :sandbox="previewSandbox(drop.kind)"
      :srcdoc="srcdoc"
      :title="drop.title"
    />
  </div>
</template>
