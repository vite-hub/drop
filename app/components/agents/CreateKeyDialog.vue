<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui"
import { type ApiKeyInput, ApiKeySchema } from "#shared/schemas"

// Creates an API key. Its name is what drops made with it show, so we nudge toward the agent's name.
const props = defineProps<{ create: (input: ApiKeyInput) => Promise<{ key: string }> }>()
const open = defineModel<boolean>("open", { default: false })

const origin = useRequestURL().origin
const notify = useNotify()
const SUGGESTIONS = ["Claude Code", "Codex", "Cursor", "Copilot", "Gemini CLI"]

const state = reactive<Partial<ApiKeyInput>>({ name: "" })
const secret = ref<string | null>(null)
const tryIt = computed(() => `export DROP_API_KEY=${secret.value}\ncurl -fsS -H "x-api-key: $DROP_API_KEY" \\\n  -F file=@plan.md ${origin}/api/files`)

watch(open, (value) => {
  if (value) return
  state.name = ""
  secret.value = null
})

async function submit(event: FormSubmitEvent<ApiKeyInput>) {
  try {
    secret.value = (await props.create(event.data)).key
  }
  catch (error) {
    notify.fail("Couldn't create the key", error)
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="secret ? 'Your new key' : 'New API key'"
    :description="secret ? 'Copy it now. You won\'t see it again.' : 'Name it after the agent that uses it. Its drops show this name and logo.'"
    :dismissible="!secret"
  >
    <template #body>
      <div v-if="secret" class="space-y-5">
        <AgentsCodeBlock :code="secret" message="Key copied" />
        <div>
          <p class="mb-2 text-sm font-medium text-highlighted">Try it</p>
          <AgentsCodeBlock :code="tryIt" />
        </div>
      </div>
      <UForm v-else id="create-key" class="space-y-3" :schema="ApiKeySchema" :state="state" @submit="submit">
        <UFormField label="Name" name="name">
          <UInput v-model="state.name" autofocus class="w-full" maxlength="60" placeholder="Claude Code" />
        </UFormField>
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="suggestion in SUGGESTIONS"
            :key="suggestion"
            color="neutral"
            size="xs"
            :variant="state.name === suggestion ? 'soft' : 'outline'"
            @click="state.name = suggestion"
          >
            <AgentIcon :name="suggestion" kind="key" class="size-3.5" />{{ suggestion }}
          </UButton>
        </div>
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="secret">
          <UButton color="neutral" label="I saved it" @click="open = false" />
        </template>
        <template v-else>
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton color="neutral" form="create-key" label="Create key" loading-auto type="submit" />
        </template>
      </div>
    </template>
  </UModal>
</template>
