<script setup lang="ts">
// Linear's ? sheet: every shortcut, grouped by where it works. ? opens it from any page that mounts this, outside text
// fields; the account menu and the ⌘K palette open it too.
const open = useShortcutsOpen()
defineShortcuts({ "?": () => (open.value = !open.value) })
</script>

<template>
  <UModal v-model:open="open" title="Keyboard shortcuts" description="Press ? on any page to see these again." :ui="{ content: 'sm:max-w-md' }">
    <template #body>
      <div class="space-y-6">
        <section v-for="group in SHORTCUT_GROUPS" :key="group.title">
          <p class="label-mono mb-2">{{ group.title }}</p>
          <ul class="divide-y divide-default rounded-lg border border-default">
            <li v-for="shortcut in group.shortcuts" :key="shortcut.label" class="flex items-center justify-between gap-4 px-3 py-2 text-sm">
              <span class="text-toned">{{ shortcut.label }}</span>
              <span class="flex shrink-0 gap-1"><UKbd v-for="key in shortcut.keys" :key="key" :value="key" /></span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UModal>
</template>
