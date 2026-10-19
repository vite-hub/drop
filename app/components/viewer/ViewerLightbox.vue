<script setup lang="ts">
// Zoomed image. Click a spot or drag a rectangle to comment; existing comments show as numbered pins and outlined
// areas. Opened from a page, it zooms out of the image's place there (FLIP), like medium-zoom.
import type { DropComment } from "#shared/types"

type Area = { ox: number; oy: number; ow: number; oh: number }

const props = defineProps<{
  src: string
  alt: string
  comments: DropComment[]
  canComment: boolean
  /** Where the image sat on the page, in viewport pixels: the zoom starts there. */
  from?: { left: number; top: number; width: number; height: number }
  /** The area being commented on, kept on screen while the popover is open. */
  draft?: Area
}>()
const emit = defineEmits<{ close: []; pick: [area: Area, x: number, y: number]; thread: [id: string, x: number, y: number] }>()
const aspect = ref(16 / 9)
const root = useTemplateRef<HTMLElement>("root")
const box = useTemplateRef<HTMLElement>("box")
const header = useTemplateRef<HTMLElement>("header")
const backdrop = useTemplateRef<HTMLElement>("backdrop")
const motion = usePreferredReducedMotion()
const animate = computed(() => motion.value !== "reduce")
// Hidden until the image is measured, so it doesn't flash at its final size before zooming there.
const shown = ref(!props.from)
onKeyStroke("Escape", () => void close())

async function loaded(event: Event) {
  if (!(event.target instanceof HTMLImageElement)) return
  const { naturalWidth, naturalHeight } = event.target
  if (naturalWidth > 0 && naturalHeight > 0) aspect.value = naturalWidth / naturalHeight
  if (shown.value) return
  await nextTick()
  shown.value = true
  const from = props.from, to = box.value?.getBoundingClientRect()
  if (!from || !to?.width || !to.height || !animate.value) return
  const easing = "cubic-bezier(0.22, 1, 0.36, 1)"
  box.value!.animate([
    { transformOrigin: "0 0", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
    { transformOrigin: "0 0", transform: "none" },
  ], { duration: 250, easing })
  for (const el of [header.value, backdrop.value]) el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing })
}

let closing = false
async function close() {
  if (closing) return
  closing = true
  if (animate.value) await root.value?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-in" }).finished.catch(() => {})
  emit("close")
}

// Thousandths of the image box. A press that barely moves is a click: a point, not an area.
const drag = ref<{ x: number; y: number; rect: DOMRect; area?: Area } | null>(null)
const at = (value: number, start: number, size: number) => Math.min(1000, Math.max(0, Math.round(((value - start) / size) * 1000)))

function press(event: PointerEvent) {
  if (!props.canComment || event.button !== 0) return
  if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId)
  drag.value = { x: event.clientX, y: event.clientY, rect: box.value!.getBoundingClientRect() }
}
function move(event: PointerEvent) {
  const d = drag.value
  if (!d || (!d.area && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 6)) return
  const left = at(Math.min(d.x, event.clientX), d.rect.left, d.rect.width), top = at(Math.min(d.y, event.clientY), d.rect.top, d.rect.height)
  d.area = { ox: left, oy: top, ow: at(Math.max(d.x, event.clientX), d.rect.left, d.rect.width) - left, oh: at(Math.max(d.y, event.clientY), d.rect.top, d.rect.height) - top }
}
function release(event: PointerEvent) {
  const d = drag.value
  if (!d) return
  drag.value = null
  if (d.area && d.area.ow > 0 && d.area.oh > 0) emit("pick", d.area, Math.min(d.x, event.clientX), Math.max(d.y, event.clientY))
  else emit("pick", { ox: at(d.x, d.rect.left, d.rect.width), oy: at(d.y, d.rect.top, d.rect.height), ow: 0, oh: 0 }, d.x, d.y)
}

const areaStyle = (area: Area) => ({ left: `${area.ox / 10}%`, top: `${area.oy / 10}%`, width: `${area.ow / 10}%`, height: `${area.oh / 10}%` })
const shownDraft = computed(() => drag.value?.area ?? props.draft)
</script>

<template>
  <div ref="root" class="fixed inset-0 z-30 flex flex-col">
    <div ref="header" class="flex h-12 shrink-0 items-center gap-3 border-b border-default bg-default px-3">
      <UButton aria-label="Close image" color="neutral" icon="i-ph-x" variant="ghost" @click="close" />
      <span class="truncate text-sm font-medium">{{ alt || "Image" }}</span>
      <span v-if="canComment" class="label-mono ml-auto">Click a spot or drag an area to comment</span>
    </div>
    <div class="relative grid min-h-0 flex-1 place-items-center overflow-auto p-6">
      <div ref="backdrop" class="absolute inset-0 bg-muted" />
      <!-- Sized from the aspect ratio: SVGs with only a viewBox have no intrinsic size. -->
      <div
        ref="box"
        class="relative select-none"
        :class="[!shown && 'invisible', canComment && 'cursor-crosshair touch-none']"
        :style="{ width: `min(100%, 1200px, calc((100dvh - 7.5rem) * ${aspect}))`, aspectRatio: String(aspect) }"
        @pointercancel="drag = null"
        @pointerdown="press"
        @pointermove="move"
        @pointerup="release"
      >
        <img :alt="alt" class="absolute inset-0 size-full rounded-md border border-default bg-default object-contain" draggable="false" :src="src" @error="shown = true" @load="loaded">
        <div v-if="shownDraft" class="pointer-events-none absolute rounded-[3px] border-[1.5px] border-inverted bg-inverted/10" :style="areaStyle(shownDraft)" />
        <template v-for="comment in comments" :key="comment.id">
          <div
            v-if="comment.ow || comment.oh"
            class="pointer-events-none absolute rounded-[3px] border-[1.5px]"
            :class="comment.resolved ? 'border-dashed border-accented' : 'border-inverted bg-inverted/5'"
            :style="areaStyle(comment)"
          />
          <button
            :aria-label="`Comment ${comment.n}`"
            class="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full font-mono text-[11px] font-medium ring-2 ring-(--ui-bg)"
            :class="comment.resolved ? 'bg-accented text-muted' : 'bg-inverted text-inverted'"
            :style="{ left: `${comment.ox / 10}%`, top: `${comment.oy / 10}%` }"
            type="button"
            @click="event => emit('thread', comment.id, event.clientX, event.clientY)"
            @pointerdown.stop
          >
            {{ comment.n }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
