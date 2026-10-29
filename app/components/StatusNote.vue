<script setup lang="ts">
// What went right says so in a small pill at the bottom that leaves on its own: no close button, no countdown bar.
// One with an action (Undo, Open) stays longer, and holds while hovered or focused. Failures stay toasts.
const note = useStatusNote()
const pill = useTemplateRef<HTMLElement>("pill")
let hovered: EventTarget | null = null
let timer: ReturnType<typeof setTimeout> | undefined
function hold() {
  clearTimeout(timer)
  if (note.value && pill.value !== hovered && !pill.value?.matches(":focus-within"))
    timer = setTimeout(() => (note.value = null), note.value.action ? 6000 : 1800)
}
watch(note, hold, { flush: "post" })
const pause = () => clearTimeout(timer)
onBeforeUnmount(pause)
function act() {
  const action = note.value?.action
  note.value = null
  action?.onClick()
}
</script>

<template>
  <div aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="note"
        ref="pill"
        :key="note.at"
        class="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full bg-inverted py-1.5 pl-3 text-sm font-medium text-inverted shadow-lg"
        :class="note.action ? 'pr-1.5' : 'pr-3'"
        @pointerenter="
          hovered = $event.currentTarget
          pause()
        "
        @pointerleave="
          hovered = null
          hold()
        "
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
