<script setup lang="ts">
// Zoomed image. Click a spot to comment on it; existing comments show as numbered pins.
import type { DropComment } from "#shared/types"

const props = defineProps<{ src: string; alt: string; comments: DropComment[]; canComment: boolean }>()
const emit = defineEmits<{ close: []; pick: [ox: number, oy: number, x: number, y: number]; thread: [id: string, x: number, y: number] }>()
const aspect = ref(16 / 9)
onKeyStroke("Escape", () => emit("close"))

function loaded(event: Event) {
  const { naturalWidth, naturalHeight } = event.target as HTMLImageElement
  if (naturalWidth > 0 && naturalHeight > 0) aspect.value = naturalWidth / naturalHeight
}
function pick(event: MouseEvent) {
  if (!props.canComment) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  emit("pick", Math.round(((event.clientX - rect.left) / rect.width) * 1000), Math.round(((event.clientY - rect.top) / rect.height) * 1000), event.clientX, event.clientY)
}
</script>

<template>
  <div class="fixed inset-0 z-30 flex flex-col bg-default">
    <div class="flex h-12 shrink-0 items-center gap-3 border-b border-default px-3">
      <UButton aria-label="Close image" color="neutral" icon="i-lucide-x" variant="ghost" @click="emit('close')" />
      <span class="truncate text-sm font-medium">{{ alt || "Image" }}</span>
      <span v-if="canComment" class="label-mono ml-auto">Click a spot to comment</span>
    </div>
    <div class="grid min-h-0 flex-1 place-items-center overflow-auto bg-muted p-6">
      <!-- Sized from the aspect ratio: SVGs with only a viewBox have no intrinsic size. -->
      <div class="relative" :style="{ width: `min(100%, 1200px, calc((100dvh - 7.5rem) * ${aspect}))`, aspectRatio: String(aspect) }">
        <img :alt="alt" class="absolute inset-0 size-full rounded-md border border-default bg-default object-contain" :class="canComment && 'cursor-crosshair'" :src="src" @click="pick" @load="loaded">
        <button
          v-for="comment in comments"
          :key="comment.id"
          :aria-label="`Comment ${comment.n}`"
          class="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full font-mono text-[11px] font-medium ring-2 ring-(--ui-bg)"
          :class="comment.resolved ? 'bg-accented text-muted' : 'bg-inverted text-inverted'"
          :style="{ left: `${comment.ox / 10}%`, top: `${comment.oy / 10}%` }"
          type="button"
          @click="event => emit('thread', comment.id, event.clientX, event.clientY)"
        >
          {{ comment.n }}
        </button>
      </div>
    </div>
  </div>
</template>
