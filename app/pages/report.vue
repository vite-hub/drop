<script setup lang="ts">
import { ReportSchema } from "#shared/schemas"
useSeoMeta({ title: "Report a drop", robots: "noindex, nofollow" })
const route = useRoute()
const state = reactive({ target: typeof route.query.target === "string" ? route.query.target : "", reason: "other" as "phishing" | "malware" | "spam" | "copyright" | "illegal/CSAM" | "other", details: "", email: "" })
const reasons = ["phishing", "malware", "spam", "copyright", "illegal/CSAM", "other"]
const sending = ref(false)
const sent = ref(false)
const error = ref("")
async function submit() {
  sending.value = true
  error.value = ""
  try {
    await $fetch("/api/reports", { method: "POST", body: state })
    sent.value = true
  }
  catch (cause) { error.value = (cause as { data?: { statusText?: string } }).data?.statusText || "Could not send the report. Try again shortly." }
  finally { sending.value = false }
}
</script>

<template>
  <div><SiteHeader /><main class="mx-auto max-w-xl space-y-5 px-6 py-12">
    <h1 class="text-2xl font-semibold">Report a drop</h1>
    <p class="text-sm text-muted">No sign-in needed. Reports go to the instance operator. Do not attach or copy illegal images. CSAM is removed immediately and reported to NCMEC or the authorities.</p>
    <p v-if="sent" role="status">Report received. Thank you.</p>
    <UForm v-else :schema="ReportSchema" :state="state" class="space-y-4" @submit="submit">
      <UFormField label="Drop or file path" name="target" required><UInput v-model="state.target" class="w-full" placeholder="/d/drop-id" :maxlength="600" /></UFormField>
      <UFormField label="Reason" name="reason" required><USelect v-model="state.reason" :items="reasons" class="w-full" /></UFormField>
      <UFormField label="Details" name="details" required><UTextarea v-model="state.details" class="w-full" :maxlength="4000" :rows="5" /></UFormField>
      <UFormField label="Email (optional)" name="email"><UInput v-model="state.email" type="email" class="w-full" :maxlength="254" /></UFormField>
      <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
      <UButton type="submit" color="neutral" label="Send report" :loading="sending" />
    </UForm>
    <p class="flex flex-wrap gap-4 text-sm"><NuxtLink to="/terms" class="underline">Terms</NuxtLink><NuxtLink to="/acceptable-use" class="underline">Acceptable use</NuxtLink><NuxtLink to="/abuse" class="underline">Copyright and abuse contact</NuxtLink></p>
  </main><SiteFooter /></div>
</template>
