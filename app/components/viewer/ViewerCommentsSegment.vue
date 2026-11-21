<script setup lang="ts">
// Comments as a mode, not a panel over the page: pressing it (C) lets the reader click or drag on the page to comment
// on that spot, and the button says so ("Click anywhere"). A segment grows beside it inside the pill, holding only
// actions: Whole page (a comment on the page itself, in the dock), All comments with the open count (the dock's list),
// and × to stop. On a phone the segment takes its own row above the pill's. With `pins`, the eye that hides the
// comments on the page sits against Comments, the thing it hides. With `style` (a Markdown doc), the segment opens with
// two icons that pick how comments on the text show, Cards or Pins (useCommentStyle).
// The `tools` slot adds buttons that act on the same comments, such as Send or Copy prompt, to the track Comments sits in.
import type { CommentStyle } from "~/composables/usePreferences"

const on = defineModel<boolean>("on", { required: true })
const style = defineModel<CommentStyle>("style")
defineProps<{
  count: number
  /** The drop's comments and replies still on their way (waitingCount), shown only when there are some. */
  waiting?: number
  listOpen: boolean
  canComment: boolean
  canUseMode: boolean
  pins?: boolean
  pinsShown?: boolean
}>()
const emit = defineEmits<{ page: []; list: []; toggle: []; pins: [] }>()

const styles = [
  { value: "card", label: "Cards beside the text", icon: "i-mingcute-layout-right-line" },
  { value: "pin", label: "Pins beside the text", icon: "i-mingcute-map-pin-line" },
] as const
const item =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-toned transition-colors hover:bg-elevated hover:text-highlighted aria-expanded:bg-elevated aria-expanded:text-highlighted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96 motion-reduce:active:scale-100"
</script>

<template>
  <!-- Comments, the eye, and Send or Copy prompt act on the same comments, so they share one track inside the pill. -->
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
        {{ on ? "Click anywhere" : "Comments" }}
        <span v-if="count && !on" class="rounded bg-elevated px-1 text-[10px] leading-[17px] tabular-nums">{{
          count
        }}</span>
      </button>
    </UTooltip>
    <!-- One count for what hasn't gone out; each comment says why under its words. -->
    <span
      v-if="waiting"
      class="inline-flex h-7 shrink-0 items-center gap-1 px-1.5 text-xs text-toned tabular-nums"
      data-waiting
      role="status"
    >
      <UIcon name="i-mingcute-time-line" class="size-3.5" />{{ waiting }} waiting
    </span>
    <!-- Pressed means hidden: pressed is the state that changes the page. -->
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
      <UTooltip v-if="canComment" text="Comment on the whole page" :content="{ side: 'top', sideOffset: 8 }">
        <button :class="item" type="button" @click="emit('page')">
          <UIcon name="i-mingcute-file-line" class="size-3.5" />Whole page
        </button>
      </UTooltip>
      <button aria-controls="drop-comments" :aria-expanded="listOpen" :class="item" type="button" @click="emit('list')">
        <UIcon name="i-mingcute-list-check-line" class="size-3.5" />All comments
        <span v-if="count && !listOpen" class="rounded bg-elevated px-1 text-[10px] leading-[17px] tabular-nums">{{
          count
        }}</span>
      </button>
      <UTooltip text="Stop commenting" :kbds="['Esc']" :content="{ side: 'top', sideOffset: 8 }">
        <button
          aria-label="Stop commenting"
          class="grid size-7 shrink-0 place-items-center rounded-md text-toned transition-colors hover:bg-elevated hover:text-highlighted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96"
          type="button"
          @click="on = false"
        >
          <UIcon name="i-mingcute-close-line" class="size-4" />
        </button>
      </UTooltip>
    </div>
  </div>
</template>

<style scoped>
/* A faint track behind the buttons. A hovered button adds the pill's 8% on top, so it still shows. */
.comment-track {
  background: rgb(255 255 255 / 7%);
}
</style>
