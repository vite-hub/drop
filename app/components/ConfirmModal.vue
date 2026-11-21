<script setup lang="ts">
const { confirmLabel = "Confirm", destructive = false } = defineProps<{
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
}>()
const emit = defineEmits<{ close: [confirmed: boolean] }>()
</script>

<template>
  <UModal
    :description="description"
    :dismissible="true"
    :title="title"
    @update:open="(value) => !value && emit('close', false)"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" label="Cancel" variant="ghost" @click="emit('close', false)" />
        <UButton
          autofocus
          :color="destructive ? 'error' : 'neutral'"
          :label="confirmLabel"
          @click="emit('close', true)"
        />
      </div>
    </template>
  </UModal>
</template>
