<script setup lang="ts">
// Opened through usePrompt(): resolves the trimmed value, or null on cancel.
const props = withDefaults(defineProps<{ title: string; label: string; placeholder?: string; initial?: string; confirmLabel?: string }>(), { placeholder: undefined, initial: "", confirmLabel: "Add" })
const emit = defineEmits<{ close: [value: string | null] }>()
const value = ref(props.initial)
const submit = () => value.value.trim() && emit("close", value.value.trim())
</script>

<template>
  <UModal :title="title" @update:open="open => !open && emit('close', null)">
    <template #body>
      <form @submit.prevent="submit">
        <UFormField :label="label">
          <UInput v-model="value" autofocus class="w-full font-mono" :placeholder="placeholder" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" label="Cancel" variant="ghost" @click="emit('close', null)" />
        <UButton color="neutral" :disabled="!value.trim()" :label="confirmLabel" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
