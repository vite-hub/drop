<script setup lang="ts">
// The list, thread, and composer sit above the same dark pill as the HTML prototype picker.
defineOptions({ inheritAttrs: false })
const props = defineProps<{ open: boolean; overlay?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const root = useTemplateRef<HTMLElement>("root")
const panel = useTemplateRef<HTMLElement>("panel")
function focusTrigger() {
  root.value?.querySelector<HTMLButtonElement>("[data-review-trigger]")?.focus({ preventScroll: true })
}
defineExpose({ focusTrigger })
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
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
      <section
        v-show="open"
        id="drop-comments"
        ref="panel"
        aria-label="Comments"
        tabindex="-1"
        class="pointer-events-auto flex h-[min(28rem,60dvh)] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[12px] border border-default surface-review outline-none focus-visible:ring-2 focus-visible:ring-inverted"
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
      <div
        role="group"
        aria-label="Document tools"
        class="review-toolbar pointer-events-auto flex max-w-full shrink-0 flex-wrap items-center justify-center gap-1 rounded-[12px] border border-default surface-review p-1"
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
  gap: 6px;
  border-radius: 8px;
  padding: 0 10px;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
}

.review-toolbar :deep([aria-label="Preview tools"] button) {
  width: 28px;
  padding: 0;
}

.review-toolbar :deep(button:where(:not(:disabled):hover)) {
  background: rgb(255 255 255 / 8%);
  color: var(--ui-text);
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

@media (pointer: coarse) {
  .review-toolbar :deep(button) {
    min-width: 44px;
    height: 44px;
  }
}
</style>
