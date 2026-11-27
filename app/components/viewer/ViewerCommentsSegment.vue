<script setup lang="ts">
import type { CommentStyle } from "~/composables/usePreferences"

const on = defineModel<boolean>("on", { required: true })
const style = defineModel<CommentStyle>("style")
defineProps<{
  count: number
  waiting?: number
  listOpen: boolean
  canUseMode: boolean
  pins?: boolean
  pinsShown?: boolean
}>()
const emit = defineEmits<{ list: []; toggle: []; pins: [] }>()

const styles = [
  { value: "card", label: "Cards beside the text", icon: "i-mingcute-layout-right-line" },
  { value: "pin", label: "Pins beside the text", icon: "i-mingcute-map-pin-line" },
] as const
const item =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-toned transition-colors hover:bg-elevated hover:text-highlighted aria-expanded:bg-elevated aria-expanded:text-highlighted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96 motion-reduce:active:scale-100"
</script>

<template>
  <div
    class="comment-track @max-3xl/review-dock:contents flex shrink-0 items-center gap-0.5 rounded-lg"
    role="group"
    aria-label="Comments"
  >
    <UTooltip
      :text="on ? 'Stop commenting' : canUseMode ? 'Comment on the page' : 'Show comments'"
      :kbds="['C']"
      :content="{ side: 'top', sideOffset: 8 }"
    >
      <button
        :aria-controls="canUseMode ? 'drop-comment-actions' : 'drop-comments'"
        aria-keyshortcuts="C"
        :aria-label="on ? 'Comments: click anywhere on the page' : count ? `Comments, ${count} open` : 'Comments'"
        :aria-pressed="canUseMode ? on : undefined"
        :aria-expanded="canUseMode ? undefined : listOpen"
        class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-toned transition-colors hover:bg-elevated hover:text-highlighted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96 motion-reduce:active:scale-100"
        :class="on && 'bg-inverted text-inverted hover:bg-inverted hover:text-inverted'"
        data-review-trigger
        type="button"
        @click="emit('toggle')"
      >
        <UIcon name="i-mingcute-chat-3-line" class="size-3.5" />
        <span data-review-label>{{ on ? "Click anywhere" : "Comments" }}</span>
        <span
          v-if="count && !on"
          data-review-label
          class="rounded bg-elevated px-1 text-[10px] leading-[17px] tabular-nums"
          >{{ count }}</span
        >
      </button>
    </UTooltip>
    <span
      v-if="waiting"
      class="inline-flex h-7 shrink-0 items-center gap-1 px-1.5 text-xs text-toned tabular-nums"
      data-waiting
      role="status"
    >
      <UIcon name="i-mingcute-time-line" class="size-3.5" />{{ waiting }} waiting
    </span>
    <UTooltip v-if="pins" text="Hide comments" :content="{ side: 'top', sideOffset: 8 }">
      <button
        aria-label="Hide comments"
        :aria-pressed="!pinsShown"
        class="-ml-1 grid size-7 shrink-0 place-items-center rounded-md text-toned transition-colors hover:bg-elevated hover:text-highlighted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96 motion-reduce:active:scale-100 pointer-coarse:ml-0"
        type="button"
        @click="emit('pins')"
      >
        <UIcon :name="pinsShown ? 'i-mingcute-eye-line' : 'i-mingcute-eye-close-line'" class="size-3.5" />
      </button>
    </UTooltip>
    <slot name="tools" />
  </div>
  <div
    id="drop-comment-actions"
    class="grid min-w-0 transition-[grid-template-columns] duration-250 ease-[cubic-bezier(.23,1,.32,1)] motion-reduce:transition-none max-sm:order-first max-sm:basis-full"
    :class="on ? 'grid-cols-[1fr]' : 'grid-cols-[0fr] max-sm:hidden'"
    :inert="!on"
    role="group"
    aria-label="Comment actions"
  >
    <div
      class="flex min-w-0 items-center gap-0.5 overflow-hidden transition-opacity duration-150 motion-reduce:transition-none max-sm:justify-center max-sm:pb-0.5"
      :class="on ? 'opacity-100 delay-75' : 'opacity-0'"
    >
      <span aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-(--ui-border) max-sm:hidden" />
      <template v-if="style">
        <UTooltip
          v-for="option in styles"
          :key="option.value"
          :text="option.label"
          :content="{ side: 'top', sideOffset: 8 }"
        >
          <button
            :aria-label="option.label"
            :aria-pressed="style === option.value"
            class="grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-highlighted aria-pressed:bg-elevated aria-pressed:text-highlighted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96 motion-reduce:active:scale-100"
            type="button"
            @click="style = option.value"
          >
            <UIcon :name="option.icon" class="size-3.5" />
          </button>
        </UTooltip>
        <span aria-hidden="true" class="w-1 shrink-0" />
      </template>
      <button aria-controls="drop-comments" :aria-expanded="listOpen" :class="item" type="button" @click="emit('list')">
        <UIcon name="i-mingcute-list-check-line" class="size-3.5" />All comments
        <span v-if="count && !listOpen" class="rounded bg-elevated px-1 text-[10px] leading-[17px] tabular-nums">{{
          count
        }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* A faint track behind the buttons. A hovered button adds the pill's 8% on top, so it still shows. */
.comment-track {
  background: rgb(255 255 255 / 7%);
}
</style>
