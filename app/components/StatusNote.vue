<script setup lang="ts">
const note = useStatusNote()
const pill = useTemplateRef<HTMLElement>("pill")
let hovered: EventTarget | null = null
const { start, stop: pause } = useTimeoutFn(
  () => (note.value = null),
  () => (note.value?.action ? 6000 : 1800),
  { immediate: false },
)
function hold() {
  pause()
  if (note.value && pill.value !== hovered && !pill.value?.matches(":focus-within")) start()
}
watch(note, hold, { flush: "post" })
function enter(event: PointerEvent) {
  hovered = event.currentTarget
  pause()
}
function leave() {
  hovered = null
  hold()
}
function act() {
  const action = note.value?.action
  note.value = null
  action?.onClick()
}
</script>

<template>
  <div
    aria-live="polite"
    class="pointer-events-none fixed inset-x-0 bottom-6 z-[100] grid justify-items-center px-4 *:col-start-1 *:row-start-1"
  >
    <Transition
      enter-active-class="transition-[opacity,translate] duration-200 ease-out"
      enter-from-class="opacity-0 motion-safe:translate-y-2"
      leave-active-class="transition-[opacity,translate] duration-150 ease-out"
      leave-to-class="opacity-0 motion-safe:translate-y-1"
    >
      <div
        v-if="note"
        ref="pill"
        :key="note.at"
        class="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full bg-inverted py-1.5 pl-3 text-sm font-medium text-inverted shadow-lg"
        :class="note.action ? 'pr-1.5' : 'pr-3'"
        @pointerenter="enter"
        @pointerleave="leave"
        @focusin="pause"
        @focusout="hold"
      >
        <UIcon :name="note.icon ?? 'i-mingcute-check-line'" class="size-4 shrink-0" />
        <span class="truncate">{{ note.title }}</span>
        <button
          v-if="note.action"
          class="ml-1.5 cursor-pointer rounded-full bg-white/15 px-2.5 py-0.5 transition-colors hover:bg-white/25 dark:bg-black/10 dark:hover:bg-black/20"
          type="button"
          @click="act"
        >
          {{ note.action.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>
