<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui"
import { DEFAULT_ROLE, ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"
import { type InviteInput, InviteSchema } from "#shared/schemas"

// Invites by email. The person signs in with GitHub using that address; nothing is sent from here.
// Same schema as POST /api/members, so the form and the server reject the same input with the same words.
const props = defineProps<{ invite: (input: InviteInput) => Promise<void> }>()
const open = defineModel<boolean>("open", { default: false })
const notify = useNotify()
const form = useTemplateRef("form")
const state = reactive<Partial<InviteInput>>({ email: "", role: DEFAULT_ROLE })
const roles = ROLES.map(value => ({ value, label: ROLE_LABELS[value], description: ROLE_SUMMARY[value] }))

watch(open, value => !value && Object.assign(state, { email: "", role: DEFAULT_ROLE }))

async function submit(event: FormSubmitEvent<InviteInput>) {
  try {
    await props.invite(event.data)
    open.value = false
  }
  catch (error) {
    // The server's sentence lands on the field it's about, not in a toast.
    form.value?.setErrors([{ name: "email", message: errorText(error) }])
    notify.fail("Couldn't invite them", error)
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Invite to Drop" description="They sign in with GitHub using this email.">
    <template #body>
      <UForm id="invite" ref="form" class="space-y-4" :schema="InviteSchema" :state="state" @submit="submit">
        <UFormField label="Email" name="email">
          <UInput v-model="state.email" autofocus class="w-full" placeholder="name@company.com" type="email" />
        </UFormField>
        <UFormField label="Role" name="role">
          <URadioGroup v-model="state.role" :items="roles" color="neutral" variant="table" />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" label="Cancel" variant="ghost" @click="open = false" />
        <UButton color="neutral" form="invite" label="Send invite" loading-auto type="submit" />
      </div>
    </template>
  </UModal>
</template>
