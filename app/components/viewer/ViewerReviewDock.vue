<script setup lang="ts">
// The list, thread, and new annotation share one panel above the document toolbar.
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
  <div
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
      class="pointer-events-auto flex h-[min(28rem,60dvh)] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-xl border border-default bg-default shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-inverted"
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
      class="pointer-events-auto flex max-w-full shrink-0 flex-wrap items-center justify-center gap-0.5 rounded-xl border border-default bg-default p-1 shadow-md"
    >
      <slot name="toolbar" />
    </div>
  </div>
</template>
