<script setup lang="ts">
// Opened through useSiteDialog(): the address a new site review covers and its name. Resolves both, or null on cancel.
// The address follows the server's rules (SiteSchema), so a typo shows here instead of after a round trip.
import type { FormSubmitEvent } from "@nuxt/ui"
import * as v from "valibot"
import { siteAddress, siteHost } from "#shared/review"
import { SiteSchema } from "#shared/schemas"

const emit = defineEmits<{ close: [value: { url: string; title?: string } | null] }>()
const formId = useId()
const schema = v.object({ url: SiteSchema.entries.url, title: SiteSchema.entries.title })
const state = reactive({ url: "", title: "" })
const placeholder = computed(() => {
  const address = siteAddress(state.url)
  return address ? siteHost(address) : "Acme previews"
})
const submit = (event: FormSubmitEvent<v.InferOutput<typeof schema>>) =>
  emit("close", { url: event.data.url, ...(event.data.title ? { title: event.data.title } : {}) })
</script>

<template>
  <UModal
    title="New site review"
    description="People comment on the live site, and their notes land here with screenshots."
    @update:open="(open) => !open && emit('close', null)"
  >
    <template #body>
      <UForm :id="formId" class="space-y-4" :schema="schema" :state="state" @submit="submit">
        <UFormField
          label="Address"
          name="url"
          help="One origin, or a pattern like https://*.preview.example.com that covers every preview."
        >
          <UInput v-model="state.url" autofocus class="w-full font-mono" placeholder="https://*.preview.example.com" />
        </UFormField>
        <UFormField label="Name" name="title" hint="Optional">
          <UInput v-model="state.title" class="w-full" :maxlength="160" :placeholder="placeholder" />
        </UFormField>
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
