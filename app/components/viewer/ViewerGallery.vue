<script setup lang="ts">
import type { DropGalleryItem } from "#shared/types"

const props = defineProps<{ items: DropGalleryItem[]; at: number; to: (item: DropGalleryItem) => string }>()
const emit = defineEmits<{ show: [index: number]; step: [by: -1 | 1] }>()
const strip = useTemplateRef<HTMLElement>("strip")
const ringed = (inline: ScrollLogicalPosition) =>
  strip.value?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest", inline })
onMounted(() => ringed("center"))
watch(
  () => props.at,
  () => nextTick(() => ringed("nearest")),
)
useEventListener("keydown", (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target
  if (target !== document.body && !(target instanceof Element && target.closest("[data-gallery]"))) return
  if (event.key === "ArrowLeft") emit("step", -1)
  else if (event.key === "ArrowRight") emit("step", 1)
  else return
  event.preventDefault()
})
function pick(event: MouseEvent, index: number) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  emit("show", index)
}
</script>

<template>
  <div
    aria-label="Images in this folder"
    class="flex max-w-full min-w-0 items-center gap-0.5"
    data-gallery
    role="group"
  >
    <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="['←']" text="Previous image">
      <button
        aria-label="Previous image"
        class="inline-flex shrink-0 items-center disabled:opacity-40"
        :disabled="at <= 0"
        type="button"
        @click="emit('step', -1)"
      >
        <UIcon aria-hidden="true" name="i-mingcute-arrow-left-line" />
      </button>
    </UTooltip>
    <div ref="strip" class="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
      <UTooltip
        v-for="(item, index) in items"
        :key="item.id"
        :content="{ side: 'top', sideOffset: 8 }"
        :text="item.title"
      >
        <NuxtLink
          :aria-current="index === at ? 'page' : undefined"
          :aria-label="item.title"
          class="relative h-7 w-10 shrink-0 overflow-hidden rounded-[6px] opacity-50 outline-none motion-safe:transition-opacity motion-safe:duration-150 after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-white/10 after:ring-inset hover:opacity-100 focus-visible:opacity-100 focus-visible:after:ring-2 focus-visible:after:ring-(--ui-bg-inverted) aria-[current=page]:opacity-100 aria-[current=page]:after:ring-2 aria-[current=page]:after:ring-(--ui-bg-inverted)"
          draggable="false"
          :to="to(item)"
          @click="pick($event, index)"
        >
          <img alt="" class="size-full object-cover object-top" loading="lazy" :src="item.thumbnail" />
        </NuxtLink>
      </UTooltip>
    </div>
    <span class="shrink-0 px-1 text-muted tabular-nums">{{ at + 1 }} / {{ items.length }}</span>
    <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="['→']" text="Next image">
      <button
        aria-label="Next image"
        class="inline-flex shrink-0 items-center disabled:opacity-40"
        :disabled="at >= items.length - 1"
        type="button"
        @click="emit('step', 1)"
      >
        <UIcon aria-hidden="true" name="i-mingcute-arrow-right-line" />
      </button>
    </UTooltip>
  </div>
</template>
