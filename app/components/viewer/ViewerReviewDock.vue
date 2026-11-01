<script setup lang="ts">
// The list, thread, and composer sit above the same dark pill as the HTML prototype picker.
defineOptions({ inheritAttrs: false })
// settle: what to wait for before the composer takes focus, which the drop's frame would otherwise hear it lose.
const props = defineProps<{ open: boolean; overlay?: boolean; settle?: () => Promise<void> }>()
const emit = defineEmits<{ close: [] }>()
const root = useTemplateRef<HTMLElement>("root")
const panel = useTemplateRef<HTMLElement>("panel")
function focusTrigger() {
  root.value?.querySelector<HTMLButtonElement>("[data-review-trigger]")?.focus({ preventScroll: true })
}
defineExpose({ focusTrigger })
// A press on the bar leaves focus in the drop's frame. The page there would hear it go and close what it has open, such
// as the tooltip someone is about to comment on. Keys and the composer still move focus.
function keepFrameFocus(event: MouseEvent) {
  if (
    document.activeElement instanceof HTMLIFrameElement &&
    event.target instanceof Element &&
    event.target.closest("button")
  )
    event.preventDefault()
}
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    await props.settle?.()
    if (!props.open) return
    const target = panel.value?.querySelector<HTMLElement>("[data-comment-editor] textarea") ?? panel.value
    target?.focus({ preventScroll: true })
  },
)
</script>

<template>
  <Teleport to="body" :disabled="!overlay">
    <div
      v-bind="$attrs"
      ref="root"
      class="pointer-events-none inset-x-2 bottom-[max(1rem,env(safe-area-inset-bottom))] flex max-h-[calc(100%-2rem)] flex-col items-center gap-2 sm:inset-x-4"
      :class="overlay ? 'fixed z-[60]' : 'absolute z-30'"
    >
      <!-- Rises out of the bar it opens from; closing is quicker and quieter, since the reader has moved on. -->
      <Transition
        enter-active-class="motion-safe:transition-[opacity,translate,scale] motion-safe:duration-200 motion-safe:ease-(--ease-out)"
        enter-from-class="translate-y-2 scale-[0.98] opacity-0"
        leave-active-class="motion-safe:transition-[opacity,translate,scale] motion-safe:duration-150 motion-safe:ease-(--ease-out)"
        leave-to-class="translate-y-1 scale-[0.98] opacity-0"
      >
        <section
          v-show="open"
          id="drop-comments"
          ref="panel"
          aria-label="Comments"
          tabindex="-1"
          class="pointer-events-auto flex h-[min(28rem,60dvh)] origin-bottom min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[12px] border border-default surface-review outline-none focus-visible:ring-2 focus-visible:ring-inverted"
          @keydown.esc.stop.prevent="emit('close')"
        >
          <div class="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-default pr-1.5 pl-4">
            <div class="flex min-w-0 flex-1 items-center justify-between gap-2"><slot name="heading" /></div>
            <UButton
              aria-label="Collapse comments"
              color="neutral"
              icon="i-mingcute-down-line"
              size="sm"
              variant="ghost"
              @click="emit('close')"
            />
          </div>
          <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"><slot name="panel" /></div>
        </section>
      </Transition>
      <div
        role="group"
        aria-label="Document tools"
        @mousedown="keepFrameFocus"
        class="review-toolbar pointer-events-auto flex max-w-full shrink-0 flex-wrap items-center justify-center gap-0.5 rounded-[12px] border border-default surface-review p-1"
      >
        <slot name="toolbar" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.review-toolbar {
  font:
    500 12px/1 ui-sans-serif,
    system-ui,
    sans-serif;
}

.review-toolbar :deep(button) {
  min-width: 28px;
  height: 28px;
  gap: 4px;
  border-radius: 8px;
  padding: 0 8px;
  background: transparent;
  /* Toned, not muted: muted at the disabled 75% opacity fell to 4.1:1 over light pages. */
  color: var(--ui-text-toned);
  font: inherit;
  touch-action: manipulation;
  transition-property: background-color, color, scale;
  transition-duration: 150ms;
  transition-timing-function: var(--ease-out);
}

.review-toolbar :deep([aria-label="Preview tools"] button),
.review-toolbar :deep([data-marker] button[data-icon]) {
  width: 28px;
  padding: 0;
}

/* Gated so a tap on a touch screen doesn't leave the button lit. */
@media (hover: hover) {
  .review-toolbar :deep(button:where(:not(:disabled):hover)) {
    background: rgb(255 255 255 / 8%);
    color: var(--ui-text);
  }
}

.review-toolbar :deep(button:where(:not(:disabled):active)) {
  scale: 0.96;
}

.review-toolbar :deep(button[aria-pressed="true"]),
.review-toolbar :deep(button[aria-expanded="true"]),
.review-toolbar :deep(button[data-review-primary]) {
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.review-toolbar :deep(button:focus-visible) {
  outline: 2px solid var(--ui-bg-inverted);
  outline-offset: 1px;
}

.review-toolbar :deep(button > .iconify) {
  width: 14px;
  height: 14px;
}

@media (prefers-reduced-motion: reduce) {
  .review-toolbar :deep(button) {
    transition: none;
  }
}

@media (pointer: coarse) {
  .review-toolbar :deep(button) {
    min-width: 44px;
    height: 44px;
  }
}
</style>
