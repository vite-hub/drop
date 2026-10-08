<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Review" })
const { data, refresh, error } = await useApi("/api/admin/review")
const notify = useNotify()
const busy = ref(false)
async function review(id: string, action: "approve" | "reject") {
  busy.value = true
  try { await $fetch(`/api/admin/review/${id}`, { method: "POST", body: { action } }); await refresh() }
  catch (cause) { notify.fail("Could not review member", cause) }
  finally { busy.value = false }
}
</script>
<template>
  <PageShell id="review" title="Review" description="Approve a member's pending shares and future public shares.">
    <div class="mb-5 flex gap-3"><UButton to="/members" label="Members" color="neutral" variant="outline" /><UButton to="/admin/reports" label="Reports" color="neutral" variant="outline" /></div>
    <p v-if="error" role="alert">Only admins can review shares.</p>
    <p v-else-if="!data?.length" role="status" class="text-muted">No shares waiting for review.</p>
    <div v-for="member in data" :key="member.id" class="mb-4 space-y-3 rounded-lg border border-default p-4">
      <h2 class="font-medium">{{ member.name }} <span class="text-muted">{{ member.email }}</span></h2>
      <p class="text-sm text-muted">GitHub account: {{ member.githubCreatedAt ? `${Math.max(0, Math.floor((Date.now() - member.githubCreatedAt) / 86400000))} days old` : "Unknown age" }} · Email {{ member.emailVerified ? "verified" : "unverified" }} · {{ member.drops }} drops</p>
      <ul class="space-y-2 text-sm"><li v-for="drop in member.shares" :key="drop.id"><NuxtLink :to="`/drops/${drop.id}`" class="underline">{{ drop.title }}</NuxtLink> · {{ drop.quarantinedAt ? "Quarantined" : drop.shareReview }}</li></ul>
      <div class="flex gap-2"><UButton :disabled="busy || Boolean(member.banned)" color="neutral" label="Approve member" @click="review(member.id, 'approve')" /><UButton :disabled="busy || Boolean(member.banned)" color="error" variant="outline" label="Reject shares" @click="review(member.id, 'reject')" /></div>
    </div>
  </PageShell>
</template>
