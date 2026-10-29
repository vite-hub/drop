<script setup lang="ts">
// A copy has nothing to undo or read twice, so its note is a small pill that leaves on its own: no close button,
// no countdown bar. Screen readers hear it through the live region.
const note = useCopyNote()
const { start } = useTimeoutFn(() => (note.value = null), 1400, { immediate: false })
watch(note, (value) => value && start())
</script>

<template>
  <div aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <p
        v-if="note"
        :key="note.at"
        class="flex items-center gap-1.5 rounded-full bg-inverted px-3 py-1.5 text-sm font-medium text-inverted shadow-lg"
      >
        <UIcon name="i-mingcute-check-line" class="size-4" />{{ note.text }}
      </p>
    </Transition>
  </div>
</template>
