<script setup lang="ts">
// The bar over a text selection, in the review dock's shape and type (ViewerReviewDock). It stands out from the page:
// the dock's dark surface on a light theme, and its light twin on a dark one.
const emit = defineEmits<{ comment: []; suggest: [] }>()
</script>

<template>
  <!-- mousedown.prevent: a press here must not take the selection away from the page. -->
  <div
    role="toolbar"
    aria-label="Selection"
    class="selection-bar flex origin-bottom items-center gap-1 rounded-[12px] border p-1 [animation:pop-in_140ms_var(--ease-out)]"
    @mousedown.prevent
  >
    <button type="button" @click="emit('comment')">
      <UIcon name="i-mingcute-chat-1-line" />
      Comment
    </button>
    <button type="button" @click="emit('suggest')">
      <UIcon name="i-mingcute-edit-2-line" />
      Suggest
    </button>
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
