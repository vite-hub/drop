<script setup lang="ts">
// The teams you're on, and a new one. A team shares its folders with its members only (server/utils/teams.ts).
useSeoMeta({ title: "Teams" })

const { data: me } = useMe()
const { create } = useTeams()
const notify = useNotify()
const teams = computed(() => me.value?.teams ?? [])
const free = computed(() => me.value?.billing?.freeMembers)
const name = ref("")
const creating = ref(false)

const description = computed(() =>
  free.value
    ? `A team shares its folders with its members. Up to ${free.value} members is free; a bigger team pays per member.`
    : "A team shares its folders with its members, and their agents publish into them.",
)

async function submit() {
  const title = name.value.trim()
  if (!title) return
  creating.value = true
  try {
    const team = await create(title)
    name.value = ""
    await navigateTo(`/teams/${team.id}`)
  } catch (error) {
    notify.fail("Couldn't make the team", error)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <PageShell id="teams" title="Teams" :count="teams.length" :description="description">
    <p v-if="me && !me.teams" class="text-sm text-muted">
      This Drop has no teams.
      <template v-if="me.mode === 'team'">Everyone signed in here is one team already.</template>
    </p>
    <template v-else>
      <form class="mb-6 flex max-w-md gap-2" @submit.prevent="submit">
        <UInput v-model="name" aria-label="Team name" class="flex-1" :maxlength="80" placeholder="Team name" />
        <UButton color="neutral" :disabled="!name.trim()" label="New team" :loading="creating" type="submit" />
      </form>
      <ul v-if="teams.length" class="divide-y divide-default overflow-hidden rounded-lg border border-default">
        <li v-for="team in teams" :key="team.id">
          <NuxtLink :to="`/teams/${team.id}`" class="flex items-center gap-3 px-4 py-3 text-sm hover:bg-elevated/50">
            <UIcon name="i-mingcute-group-2-line" class="size-4 text-muted" />
            <span class="min-w-0 flex-1 truncate font-medium text-highlighted">{{ team.name }}</span>
            <UBadge v-if="team.paid" color="neutral" label="Team plan" size="sm" variant="subtle" />
            <span class="text-xs text-muted capitalize">{{ team.role }}</span>
          </NuxtLink>
        </li>
      </ul>
      <p v-else class="text-sm text-muted">
        You're on no team yet. Make one, or open an invitation link someone sent you.
      </p>
    </template>
  </PageShell>
</template>
