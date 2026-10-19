<script setup lang="ts">
// Opened through useFolderDialog(): a new folder's name, what goes in it, and, for admins on a team Drop, whether it's
// one of the team's. Resolves them, or null on cancel. Agents read the description to choose where to publish.
import type { FormSubmitEvent } from "@nuxt/ui"
import * as v from "valibot"
import { FolderSchema } from "#shared/schemas"

const { offerTeam = false, team = false } = defineProps<{ offerTeam?: boolean; team?: boolean; inside?: string }>()
const emit = defineEmits<{ close: [value: { title: string; description?: string; team: boolean } | null] }>()
const formId = useId()
const schema = v.object({ title: FolderSchema.entries.title, description: FolderSchema.entries.description })
const state = reactive({ title: "", description: "", team })
const submit = (event: FormSubmitEvent<v.InferOutput<typeof schema>>) =>
  emit("close", { title: event.data.title, ...(event.data.description ? { description: event.data.description } : {}), team: state.team })
</script>

<template>
  <UModal :title="inside ? `New folder in ${inside}` : 'New folder'" description="Say what goes in it: your agents read this to put things in the right place." @update:open="open => !open && emit('close', null)">
    <template #body>
      <UForm :id="formId" class="space-y-4" :schema="schema" :state="state" @submit="submit">
        <UFormField label="Name" name="title">
          <UInput v-model="state.title" autofocus class="w-full" :maxlength="160" placeholder="Meeting notes" />
        </UFormField>
        <UFormField label="Description" name="description" hint="Optional" help="What belongs in it, and how to name and write it.">
          <UTextarea v-model="state.description" autoresize class="w-full" :maxlength="2000" :maxrows="10" placeholder="Notes from calls, one doc per meeting, named YYYY-MM-DD-topic. Start with who was there, then decisions, then action items." :rows="3" />
        </UFormField>
        <USwitch v-if="offerTeam" v-model="state.team" description="Everyone adds to it and finds it under Team. Only admins rename, describe, or share it." label="The team's folder" />
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" label="Cancel" variant="ghost" @click="emit('close', null)" />
        <UButton color="neutral" :form="formId" label="Create" type="submit" />
      </div>
    </template>
  </UModal>
</template>
