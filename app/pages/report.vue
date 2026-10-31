<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui"
import type { InferInput } from "valibot"
import { ReportSchema } from "#shared/schemas"
useSeoMeta({ title: "Report a drop", robots: "noindex, nofollow" })
const route = useRoute("report")
const state = reactive<InferInput<typeof ReportSchema>>({
  target: textValue(route.query.target) ?? "",
  reason: "other",
  details: "",
  email: "",
})
// The stored values stay as they are; people pick from sentence-case labels.
const REASON_LABELS: Record<(typeof ReportSchema.entries.reason.options)[number], string> = {
  phishing: "Phishing",
  malware: "Malware",
  spam: "Spam",
  copyright: "Copyright",
  "illegal/CSAM": "Illegal content or CSAM",
  other: "Something else",
}
const reasons = ReportSchema.entries.reason.options.map((value) => ({ label: REASON_LABELS[value], value }))
const form = useTemplateRef("form")
const sent = ref(false)
const sending = ref(false)
const error = ref("")
async function submit(event: FormSubmitEvent<InferInput<typeof ReportSchema>>) {
  error.value = ""
  sending.value = true
  try {
    await sendReport(event.data)
    sent.value = true
  } catch (cause) {
    error.value = errorText(cause, "Could not send the report. Try again shortly.")
  } finally {
    sending.value = false
  }
}
// ⌘/Ctrl+Enter in Details sends, as the button does; not again while a send is out.
const shortcut = () => void (sending.value || form.value?.submit())
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <SiteHeader />
    <main class="mx-auto w-full flex-1 max-w-xl space-y-5 px-6 py-12">
      <h1 class="text-2xl font-semibold">Report a drop</h1>
      <p class="text-sm text-muted">
        No sign-in needed. Reports go to the instance operator. Do not attach or copy illegal images. CSAM is removed
        immediately and reported to NCMEC or the authorities.
      </p>
      <p v-if="sent" role="status" class="rounded-lg border border-default p-4 text-sm">
        Report received. The operator reviews it{{ state.email ? ` and can reply to ${state.email}` : "" }}.
      </p>
      <UForm v-else ref="form" :schema="ReportSchema" :state="state" class="space-y-4" @submit="submit">
        <UFormField label="Drop or file path" name="target" required
          ><UInput
            v-model="state.target"
            autocomplete="off"
            class="w-full"
            placeholder="/d/drop-id"
            spellcheck="false"
            :maxlength="600"
        /></UFormField>
        <UFormField label="Reason" name="reason" required
          ><USelect v-model="state.reason" :items="reasons" class="w-full"
        /></UFormField>
        <UFormField label="Details" name="details" help="Describe what needs review." required
          ><UTextarea
            v-model="state.details"
            class="w-full"
            :maxlength="4000"
            :rows="5"
            @keydown.meta.enter="shortcut"
            @keydown.ctrl.enter="shortcut"
        /></UFormField>
        <UFormField label="Email (optional)" name="email"
          ><UInput v-model="state.email" autocomplete="email" type="email" class="w-full" :maxlength="254"
        /></UFormField>
        <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
        <UButton type="submit" color="neutral" label="Send report" loading-auto />
      </UForm>
      <p class="flex flex-wrap gap-4 text-sm">
        <NuxtLink to="/terms" class="underline underline-offset-4">Terms</NuxtLink
        ><NuxtLink to="/acceptable-use" class="underline underline-offset-4">Acceptable use</NuxtLink
        ><NuxtLink to="/abuse" class="underline underline-offset-4">Copyright and abuse contact</NuxtLink>
      </p>
    </main>
    <SiteFooter />
  </div>
</template>
