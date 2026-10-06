<script setup lang="ts">
import { DEFAULT_ROLE, ROLE_LABELS, ROLE_SUMMARY, ROLES, type Role } from "#shared/roles"

// Invites by email. The person signs in with GitHub using that address; nothing is sent from here.
const open = defineModel<boolean>("open", { default: false })
const emit = defineEmits<{ invited: [] }>()

const toast = useToast()
const email = ref("")
const role = ref<Role>(DEFAULT_ROLE)
const busy = ref(false)
const valid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))
const roles = ROLES.map(value => ({ value, label: ROLE_LABELS[value], description: ROLE_SUMMARY[value] }))

watch(open, (value) => {
  if (value) return
  email.value = ""
  role.value = DEFAULT_ROLE
  busy.value = false
})

async function send() {
  if (!valid.value || busy.value) return
  busy.value = true
  const address = email.value.trim()
  try {
    await $fetch("/api/members", { method: "POST", body: { email: address, role: role.value } })
    toast.add({ title: `Invited ${address}`, description: `They join as ${ROLE_LABELS[role.value]} when they sign in with GitHub.` })
    emit("invited")
    open.value = false
  }
  catch (error) {
    toast.add({ title: "Couldn't invite them", description: errorText(error), color: "error" })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Invite to Drop" description="They sign in with GitHub using this email.">
    <template #body>
      <form class="space-y-4" @submit.prevent="send">
        <UFormField label="Email">
          <UInput v-model="email" autofocus class="w-full" placeholder="name@company.com" type="email" />
        </UFormField>
        <UFormField label="Role">
          <URadioGroup v-model="role" :items="roles" color="neutral" variant="table" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" label="Cancel" variant="ghost" @click="open = false" />
        <UButton color="neutral" :disabled="!valid" :loading="busy" label="Send invite" @click="send" />
      </div>
    </template>
  </UModal>
</template>
