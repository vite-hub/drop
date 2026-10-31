<script setup lang="ts">
// The Marker's controls, in the review dock while the reader draws on a snapshot of the page: the tip, its size, its
// colour, Undo, and Cancel or Done. Done sends the snapshot with the strokes as one comment.
const { pen, marks, finishing } = defineProps<{ pen: MarkPen; marks: number; finishing: boolean }>()
const emit = defineEmits<{
  tip: [tip: MarkTip]
  color: [color: MarkColor]
  size: [index: number]
  undo: []
  cancel: []
  done: []
}>()

// The dots grow with the size; the marker's are see-through like its ink.
const DOTS = [5, 8, 11, 15]
const sizes = computed(() => MARK_TIPS[pen.tip].sizes.map((px, index) => ({ px, index, dot: DOTS[index]! })))
const colorName = (name: string) => name[0]!.toUpperCase() + name.slice(1)
</script>

<template>
  <div aria-label="Marker" class="flex items-center gap-1" data-marker role="group">
    <span class="flex items-center gap-1.5 pr-1 pl-2 text-muted">
      <UIcon aria-hidden="true" class="size-3.5" name="i-mingcute-camera-line" />Snapshot
    </span>
    <span aria-hidden="true" class="mx-0.5 h-[18px] w-px shrink-0 bg-(--ui-border)" data-divider />
    <UTooltip v-for="(tip, id) in MARK_TIPS" :key="id" :content="{ side: 'top', sideOffset: 8 }">
      <button
        :aria-keyshortcuts="tip.key"
        :aria-label="tip.label"
        :aria-pressed="pen.tip === id"
        class="grid place-items-center"
        data-icon
        type="button"
        @click="emit('tip', id)"
      >
        <UIcon aria-hidden="true" :name="tip.icon" />
      </button>
      <template #content>
        {{ tip.label }}<span class="ml-1.5 opacity-60">{{ tip.key }}</span>
      </template>
    </UTooltip>
    <span aria-hidden="true" class="mx-0.5 h-[18px] w-px shrink-0 bg-(--ui-border)" data-divider />
    <UTooltip v-for="size in sizes" :key="size.index" :content="{ side: 'top', sideOffset: 8 }">
      <button
        :aria-label="`Size ${size.index + 1} of ${sizes.length}, ${size.px} pixels`"
        :aria-pressed="pen.sizes[pen.tip] === size.index"
        class="grid place-items-center"
        data-icon
        type="button"
        @click="emit('size', size.index)"
      >
        <span
          aria-hidden="true"
          class="block rounded-full"
          :style="{
            width: `${size.dot}px`,
            height: `${size.dot}px`,
            background: MARK_COLORS[pen.color],
            opacity: pen.tip === 'marker' ? 0.55 : 1,
          }"
        />
      </button>
      <template #content> {{ size.px }}px<span class="ml-1.5 opacity-60">[ ]</span> </template>
    </UTooltip>
    <span aria-hidden="true" class="mx-0.5 h-[18px] w-px shrink-0 bg-(--ui-border)" data-divider />
    <button
      v-for="(hex, name) in MARK_COLORS"
      :key="name"
      :aria-label="`${colorName(name)} ink`"
      :aria-pressed="pen.color === name"
      class="grid place-items-center"
      data-icon
      type="button"
      @click="emit('color', name)"
    >
      <span aria-hidden="true" class="block size-3.5 rounded-full ring-1 ring-black/10" :style="{ background: hex }" />
    </button>
    <span aria-hidden="true" class="mx-0.5 h-[18px] w-px shrink-0 bg-(--ui-border)" data-divider />
    <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="['meta', 'z']" text="Undo">
      <button
        aria-keyshortcuts="Meta+Z Control+Z"
        aria-label="Undo"
        class="grid place-items-center"
        data-icon
        :disabled="!marks"
        type="button"
        @click="emit('undo')"
      >
        <UIcon aria-hidden="true" name="i-mingcute-back-2-line" />
      </button>
    </UTooltip>
    <UButton color="neutral" label="Cancel" size="xs" variant="ghost" @click="emit('cancel')" />
    <UButton
      aria-keyshortcuts="Enter"
      color="neutral"
      data-review-primary
      :disabled="!marks"
      label="Done"
      :loading="finishing"
      size="xs"
      @click="emit('done')"
    />
  </div>
</template>
