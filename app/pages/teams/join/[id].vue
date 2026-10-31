<script setup lang="ts">
// An invitation link. Signed in with the invited email, you join the team and its folders; Better Auth checks the email.
useSeoMeta({ title: "Join a team" })

const route = useRoute()
const id = String(route.params.id)
const teams = useTeams()
const notify = useNotify()
const {
  data: invitation,
  error,
  status,
} = useAsyncData(`invitation:${id}`, () => teams.invitation(id), {
  default: () => null,
  server: false,
})
const joining = ref(false)

async function join() {
  joining.value = true
  try {
    const joined = await teams.accept(id)
    await navigateTo(`/teams/${joined.invitation.organizationId}`)
  } catch (failure) {
    notify.fail("Couldn't join the team", failure)
    joining.value = false
  }
}
</script>

<template>
  <PageShell id="team-join" title="Join a team">
    <div class="max-w-md space-y-3 text-sm">
      <template v-if="status === 'pending' && !invitation">
        <USkeleton class="h-4 w-full" />
        <USkeleton class="h-4 w-2/3" />
        <USkeleton class="h-9 w-32" />
      </template>
      <template v-else-if="invitation">
        <p>
          <span class="font-medium text-highlighted">{{ invitation.inviterEmail }}</span> invited you to
          <span class="font-medium text-highlighted">{{ invitation.organizationName }}</span
          >. Its folders, and what its members share in them, open to you and your agents.
        </p>
        <UButton color="neutral" label="Join the team" :loading="joining" @click="join" />
      </template>
      <p v-else-if="error" class="text-muted">
        This invitation is for another email, was cancelled, or has expired. Sign in with the email it was sent to, or
        ask for a new link.
      </p>
    </div>
  </PageShell>
</template>
