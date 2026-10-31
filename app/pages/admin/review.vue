<script setup lang="ts">
useSeoMeta({ title: "Review" })
const { data, error } = await useApi("/api/admin/review", { key: keys.adminReview })
const now = useRelativeNow()
// The sidebar's Members count comes from /api/me, so it reloads with the queue.
const { busy, run } = useAdminAction(
  (id) => `/api/admin/review/${id}`,
  "Could not review member",
  () => refreshNuxtData([keys.adminReview, keys.me]),
)
const pending = computed(() =>
  data.value?.flatMap((member) => member.shares).filter((s) => s.shareReview === "pending"),
)
const review = (id: string, action: "approve" | "reject") => run(id, action)
</script>
<template>
  <PageShell
    id="review"
    title="Review"
    :count="pending?.length"
    description="Approve a member's pending shares and future public shares."
  >
    <template #actions
      ><UButton to="/_vitehub/auth" external label="Users" color="neutral" size="sm" variant="ghost" /><UButton
        to="/admin/reports"
        label="Reports"
        color="neutral"
        size="sm"
        variant="ghost"
    /></template>
    <p v-if="error" role="alert" class="text-sm">Only admins can review shares.</p>
    <p v-else-if="!data?.length" role="status" class="text-sm text-muted">No shares waiting for review.</p>
    <div v-for="member in data" :key="member.id" class="mb-4 space-y-3 rounded-lg border border-default p-4">
      <h2 class="font-medium">
        {{ member.name }} <span class="text-muted">{{ member.email }}</span>
      </h2>
      <p class="text-sm text-muted">
        GitHub account:
        {{
          member.githubCreatedAt
            ? `${Math.max(0, Math.floor((now - member.githubCreatedAt) / 86400000))} days old`
            : "Unknown age"
        }}
        · Email {{ member.emailVerified ? "verified" : "unverified" }} · {{ member.drops }} drops
      </p>
      <ul class="space-y-2 text-sm">
        <li v-for="drop in member.shares" :key="drop.id">
          <NuxtLink :to="`/drops/${drop.id}`" class="underline">{{ drop.title }}</NuxtLink> ·
          {{ drop.quarantinedAt ? "Quarantined" : drop.shareReview }}
        </li>
      </ul>
      <div class="flex gap-2">
        <UButton
          :disabled="busy || Boolean(member.banned)"
          color="neutral"
          label="Approve member"
          @click="review(member.id, 'approve')"
        /><UButton
          :disabled="busy || Boolean(member.banned)"
          color="error"
          variant="outline"
          label="Reject shares"
          @click="review(member.id, 'reject')"
        />
      </div>
    </div>
  </PageShell>
</template>
