<script setup lang="ts">
// Linear's ? sheet: every shortcut, grouped by where it works. ? opens it from any page that mounts this, outside text
// fields; the account menu and the ⌘K palette open it too. It sits in the bottom right without covering the page, so
// the reader can try a shortcut while it's open; Escape or ? closes it.
const open = useShortcutsOpen()
defineShortcuts({ "?": () => (open.value = !open.value) })
onKeyStroke("Escape", () => (open.value = false))

const panel = useTemplateRef<HTMLElement>("panel")
// Focus goes to the sheet so a screen reader reads it, and back to where it was when it closes.
let returnFocus: HTMLElement | null = null
watch(open, async (now) => {
  if (now) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    panel.value?.focus({ preventScroll: true })
  } else if (panel.value?.contains(document.activeElement)) returnFocus?.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <!-- Rises out of the corner it sits in; the exit retraces it, faster. Reduced motion keeps only the fade. -->
    <Transition
      enter-active-class="transition-[opacity,translate,scale] duration-200 ease-(--ease-out)"
      enter-from-class="opacity-0 translate-y-2 scale-97 motion-reduce:translate-y-0 motion-reduce:scale-100"
      leave-active-class="transition-[opacity,translate,scale] duration-150 ease-(--ease-out)"
      leave-to-class="opacity-0 translate-y-2 scale-97 motion-reduce:translate-y-0 motion-reduce:scale-100"
    >
      <section
        v-if="open"
        ref="panel"
        aria-labelledby="shortcuts-title"
        class="fixed right-4 bottom-4 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] origin-bottom-right flex-col rounded-lg border border-default bg-default shadow-lg outline-none"
        role="dialog"
        tabindex="-1"
      >
        <header class="flex items-start gap-3 border-b border-default py-3 pr-3 pl-5">
          <div class="min-w-0 flex-1 pt-1">
            <h2 id="shortcuts-title" class="text-sm font-medium text-highlighted">Keyboard shortcuts</h2>
            <p class="mt-0.5 text-xs text-muted">Press <UKbd value="?" /> to open this again, Esc to close it.</p>
          </div>
          <UButton aria-label="Close" color="neutral" icon="i-ph-x" size="sm" variant="ghost" @click="open = false" />
        </header>
        <div class="space-y-5 overflow-y-auto px-5 py-4">
          <section v-for="group in SHORTCUT_GROUPS" :key="group.title">
            <p class="label-mono mb-2">{{ group.title }}</p>
            <ul class="divide-y divide-default rounded-lg border border-default">
              <li
                v-for="shortcut in group.shortcuts"
                :key="shortcut.label"
                class="flex items-center justify-between gap-4 px-3 py-2 text-sm"
              >
                <span class="text-toned">{{ shortcut.label }}</span>
                <span class="flex shrink-0 gap-1"><UKbd v-for="key in shortcut.keys" :key="key" :value="key" /></span>
              </li>
            </ul>
          </section>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>
