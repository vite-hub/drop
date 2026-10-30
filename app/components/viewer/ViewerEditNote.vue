<script setup lang="ts">
// Edit, for a doc the live editor can't open. A disabled button swallows hover and click, so the reason never showed;
// this one stays clickable and says why, with the way to change the doc anyway.
defineProps<{ note: string; canComment: boolean }>()
const emit = defineEmits<{ copy: [] }>()
const open = defineModel<boolean>("open", { default: false })

function copy() {
  emit("copy")
  open.value = false
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ side: 'top', sideOffset: 8, collisionPadding: 8 }"
    :ui="{ content: 'w-80 max-w-[calc(100vw-1rem)] motion-reduce:animate-none' }"
  >
    <template #default="{ open: shown }">
      <UTooltip :disabled="shown" text="Why can't I edit?">
        <UButton
          aria-label="Edit, unavailable"
          color="neutral"
          icon="i-mingcute-pencil-line"
          label="Edit"
          size="xs"
          variant="ghost"
        />
      </UTooltip>
    </template>
    <template #content>
      <div class="p-3">
        <p class="flex items-center gap-1.5 text-sm font-medium text-highlighted">
          <UIcon aria-hidden="true" class="size-4 shrink-0 text-muted" name="i-mingcute-lock-line" />
          This doc can't be edited in Drop
        </p>
        <p class="mt-1 text-sm/5 text-pretty text-muted">{{ note }}</p>
        <p class="mt-2 text-sm/5 text-pretty text-muted">
          Ask your agent to change it instead. It publishes the new version at this link, and comments carry over.
        </p>
        <div class="mt-3 flex items-center gap-2">
          <UButton
            color="neutral"
            icon="i-mingcute-copy-2-line"
            label="Copy Markdown"
            size="xs"
            variant="outline"
            @click="copy"
          />
          <span v-if="canComment" class="text-xs text-dimmed">or select text to comment</span>
        </div>
      </div>
    </template>
  </UPopover>
</template>
