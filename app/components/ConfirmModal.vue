<script setup lang="ts">
// Opened through useConfirm(): resolves true when confirmed, false on cancel or dismiss.
withDefaults(defineProps<{ title: string; description?: string; confirmLabel?: string; destructive?: boolean }>(), { description: undefined, confirmLabel: "Confirm", destructive: false })
const emit = defineEmits<{ close: [confirmed: boolean] }>()
</script>

<template>
  <UModal :description="description" :dismissible="true" :title="title" @update:open="value => !value && emit('close', false)">
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" label="Cancel" variant="ghost" @click="emit('close', false)" />
        <UButton autofocus :color="destructive ? 'error' : 'neutral'" :label="confirmLabel" @click="emit('close', true)" />
      </div>
    </template>
  </UModal>
</template>
