<script setup lang="ts">
// Creates an API key. Its name is what drops made with it show, so we nudge toward the agent's name.
const open = defineModel<boolean>("open", { default: false })
const emit = defineEmits<{ created: [] }>()

const origin = useRequestURL().origin
const toast = useToast()
const SUGGESTIONS = ["Claude Code", "Codex", "Cursor", "Copilot", "Gemini CLI"]

const name = ref("")
const secret = ref<string | null>(null)
const busy = ref(false)
const tryIt = computed(() => `export DROP_API_KEY=${secret.value}\ncurl -fsS -H "x-api-key: $DROP_API_KEY" \\\n  -F file=@plan.md ${origin}/api/files`)

watch(open, (value) => {
  if (value) return
  name.value = ""
  secret.value = null
  busy.value = false
})

async function create() {
  const value = name.value.trim()
  if (!value || busy.value) return
  busy.value = true
  try {
    const created = await $fetch<{ id: string; key: string; name: string }>("/api/keys", { method: "POST", body: { name: value } })
    secret.value = created.key
    emit("created")
  }
  catch (error) {
    toast.add({ title: "Couldn't create the key", description: errorText(error), color: "error" })
  }
  finally {
    busy.value = false
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
      <form v-else class="space-y-3" @submit.prevent="create">
        <UFormField label="Name">
          <UInput v-model="name" autofocus class="w-full" maxlength="60" placeholder="Claude Code" />
        </UFormField>
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="suggestion in SUGGESTIONS"
            :key="suggestion"
            color="neutral"
            size="xs"
            :variant="name === suggestion ? 'soft' : 'outline'"
            @click="name = suggestion"
          >
            <AgentIcon :name="suggestion" kind="key" class="size-3.5" />{{ suggestion }}
          </UButton>
        </div>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="secret">
          <UButton color="neutral" label="I saved it" @click="open = false" />
        </template>
        <template v-else>
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton color="neutral" :disabled="!name.trim()" :loading="busy" label="Create key" @click="create" />
        </template>
      </div>
    </template>
  </UModal>
</template>
