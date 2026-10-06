<script setup lang="ts">
// Opened through usePrompt(): resolves the trimmed value, or null on cancel. Validates with a valibot schema
// whose single field is `value` (defaults to "not empty").
import type { FormSubmitEvent } from "@nuxt/ui"
import * as v from "valibot"

const props = withDefaults(defineProps<{
  title: string
  label: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
  schema?: v.GenericSchema<string, string>
}>(), { placeholder: undefined, initial: "", confirmLabel: "Add", schema: undefined })
const emit = defineEmits<{ close: [value: string | null] }>()
const schema = v.object({ value: props.schema ?? v.pipe(v.string(), v.trim(), v.minLength(1, "Enter a value.")) })
const state = reactive({ value: props.initial })
const submit = (event: FormSubmitEvent<{ value: string }>) => emit("close", event.data.value)
</script>

<template>
  <UModal :title="title" @update:open="open => !open && emit('close', null)">
    <template #body>
      <UForm id="prompt" :schema="schema" :state="state" @submit="submit">
        <UFormField :label="label" name="value">
          <UInput v-model="state.value" autofocus class="w-full font-mono" :placeholder="placeholder" />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" label="Cancel" variant="ghost" @click="emit('close', null)" />
        <UButton color="neutral" form="prompt" :label="confirmLabel" type="submit" />
      </div>
    </template>
  </UModal>
</template>
