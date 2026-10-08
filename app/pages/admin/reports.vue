<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Reports" })
const { data, refresh, error } = await useApi("/api/admin/reports")
const notify = useNotify()
const busy = ref(false)
async function act(id: string, action: "dismiss" | "quarantine" | "ban") {
  busy.value = true
  try { await $fetch(`/api/admin/reports/${id}`, { method: "POST", body: { action } }); await refresh() }
  catch (cause) { notify.fail("Could not update report", cause) }
  finally { busy.value = false }
}
</script>
<template>
  <PageShell id="reports" title="Reports" description="Quarantine stops serving a drop, including its older versions. Ban stops all the owner's drops.">
    <UButton class="mb-5" to="/admin/review" label="Review shares" color="neutral" variant="outline" />
    <p v-if="error" role="alert">Only admins can read reports.</p>
    <p v-else-if="!data?.length" role="status" class="text-muted">No reports.</p>
    <div v-for="report in data" :key="report.id" class="mb-4 space-y-3 rounded-lg border border-default p-4">
      <h2 class="font-medium">{{ report.reason }} · {{ report.status }}</h2>
      <p class="break-all font-mono text-xs">{{ report.target }}</p>
      <p class="whitespace-pre-wrap break-words text-sm">{{ report.details }}</p>
      <p class="text-xs text-muted">{{ new Date(report.createdAt).toLocaleString() }} · {{ report.email || "No contact email" }}</p>
      <div class="flex flex-wrap gap-2"><UButton v-if="report.status === 'open'" :disabled="busy" color="neutral" variant="outline" label="Dismiss" @click="act(report.id, 'dismiss')" /><UButton :disabled="busy" color="error" variant="outline" label="Quarantine drop" @click="act(report.id, 'quarantine')" /><UButton v-if="report.ownerId" :disabled="busy" color="error" label="Ban owner" @click="act(report.id, 'ban')" /></div>
    </div>
  </PageShell>
</template>
