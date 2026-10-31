<script setup lang="ts">
// The bar over a text selection, in the review dock's shape and type (ViewerReviewDock). It stands out from the page:
// the dock's dark surface on a light theme, and its light twin on a dark one.
const emit = defineEmits<{ comment: []; suggest: [] }>()
const actions = [
  { label: "Comment", hint: "Comment on it", kbd: "C", icon: "i-mingcute-chat-1-line", press: () => emit("comment") },
  {
    label: "Suggest",
    hint: "Suggest new words",
    kbd: "E",
    icon: "i-mingcute-edit-2-line",
    press: () => emit("suggest"),
  },
]
</script>

<template>
  <!-- mousedown.prevent: a press here must not take the selection away from the page. -->
  <div
    role="group"
    aria-label="Selected text"
    class="selection-bar flex origin-bottom items-center gap-1 rounded-[12px] border p-1 [animation:pop-in_140ms_var(--ease-out)]"
    @mousedown.prevent
  >
    <!-- The keys work from the page too (C, E), where focus stays while text is selected. -->
    <UTooltip v-for="action in actions" :key="action.kbd" :content="{ side: 'top', sideOffset: 8 }">
      <button :aria-keyshortcuts="action.kbd" type="button" @click="action.press">
        <UIcon aria-hidden="true" :name="action.icon" />
        {{ action.label }}
      </button>
      <template #content>
        {{ action.hint }}<span class="ml-1.5 opacity-60">{{ action.kbd }}</span>
      </template>
    </UTooltip>
  </div>
</template>

<style scoped>
.selection-bar {
  --bar-bg: rgb(17 17 17 / 92%);
  --bar-border: rgb(255 255 255 / 12%);
  --bar-text: #d4d4d4;
  --bar-text-hover: #fafafa;
  --bar-hover: rgb(255 255 255 / 8%);
  --bar-ring: #fafafa;
  border-color: var(--bar-border);
  background: var(--bar-bg);
  box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font:
    500 12px/1 ui-sans-serif,
    system-ui,
    sans-serif;
}

.dark .selection-bar {
  --bar-bg: rgb(250 250 250 / 94%);
  --bar-border: rgb(0 0 0 / 10%);
  --bar-text: #404040;
  --bar-text-hover: #0a0a0a;
  --bar-hover: rgb(0 0 0 / 6%);
  --bar-ring: #0a0a0a;
  box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
}

button {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 28px;
  gap: 6px;
  border-radius: 8px;
  padding: 0 10px;
  color: var(--bar-text);
  cursor: pointer;
  touch-action: manipulation;
  transition-property: background-color, color, scale;
  transition-duration: 150ms;
  transition-timing-function: var(--ease-out);
}

/* 28px to match the dock, with a taller hit area for fingers; the 4px gap keeps neighbours from overlapping. */
button::before {
  content: "";
  position: absolute;
  inset: -8px -2px;
}

button > .iconify {
  width: 14px;
  height: 14px;
}

/* Gated so a tap on a touch screen doesn't leave the button lit. */
@media (hover: hover) {
  button:hover {
    background: var(--bar-hover);
    color: var(--bar-text-hover);
  }
}

button:active {
  scale: 0.96;
}

button:focus-visible {
  outline: 2px solid var(--bar-ring);
  outline-offset: 1px;
}
</style>
