<script setup lang="ts">
useSeoMeta({ title: "Reports" })
const { data, refresh, error } = await useApi("/api/admin/reports", { key: keys.adminReports })
const { busy, run } = useAdminAction((id) => `/api/admin/reports/${id}`, "Could not update report", refresh)
const confirm = useConfirm()
// Quarantine and Ban take drops offline for everyone who opens them, so they ask first; Dismiss doesn't.
const CONFIRMS = {
  quarantine: {
    title: "Quarantine this drop?",
    description: "Drop stops serving it, including its older versions.",
    confirmLabel: "Quarantine",
  },
  ban: {
    title: "Ban this drop's owner?",
    description: "Drop stops serving every drop they own.",
    confirmLabel: "Ban owner",
  },
}
async function act(id: string, action: "dismiss" | "quarantine" | "ban") {
  if (action !== "dismiss" && !(await confirm({ ...CONFIRMS[action], destructive: true }))) return
  await run(id, action)
}
</script>
<template>
  <PageShell
    id="reports"
    title="Reports"
    :count="data?.length"
    description="Quarantine stops serving a drop, including its older versions. Ban stops all the owner's drops."
  >
    <template #actions
      ><UButton to="/admin/review" label="Review shares" color="neutral" size="sm" variant="ghost"
    /></template>
    <p v-if="error" role="alert" class="text-sm">Only admins can read reports.</p>
    <p v-else-if="!data?.length" role="status" class="text-sm text-muted">No reports. New ones show up here.</p>
    <div v-for="report in data" :key="report.id" class="mb-4 space-y-3 rounded-lg border border-default p-4">
      <h2 class="font-medium">{{ report.reason }} · {{ report.status }}</h2>
      <p class="break-all font-mono text-xs">{{ report.target }}</p>
      <p class="whitespace-pre-wrap break-words text-sm">{{ report.details }}</p>
      <p class="text-xs text-muted">
        <NuxtTime :datetime="report.createdAt" locale="en" date-style="medium" time-style="short" time-zone="UTC" /> UTC
        · {{ report.email || "No contact email" }}
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="report.status === 'open'"
          :disabled="busy"
          color="neutral"
          variant="outline"
          label="Dismiss"
          @click="act(report.id, 'dismiss')"
        /><UButton
          :disabled="busy"
          color="error"
          variant="outline"
          label="Quarantine drop"
          @click="act(report.id, 'quarantine')"
        /><UButton
          v-if="report.ownerId"
          :disabled="busy"
          color="error"
          label="Ban owner"
          @click="act(report.id, 'ban')"
        />
      </div>
    </div>
  </PageShell>
</template>
