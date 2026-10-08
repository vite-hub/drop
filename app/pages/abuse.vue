<script setup lang="ts">
// Legal template. The instance owner must review this source, contact details, and DMCA procedures before public use.
useSeoMeta({ title: "Copyright and abuse contact" })
const { data: contact } = await useFetch("/api/abuse-contact")
</script>
<template>
  <div><SiteHeader /><main class="mx-auto max-w-2xl space-y-5 px-6 py-12">
    <h1 class="text-2xl font-semibold">Copyright and abuse contact</h1>
    <p>Use the <NuxtLink to="/report" class="underline">report form</NuxtLink> to report abuse. Include the Drop link and enough detail to locate the problem.</p>
    <p v-if="contact?.email">You can also contact the operator at <a :href="`mailto:${contact.email}`" class="underline">{{ contact.email }}</a>.</p>
    <p v-else>No contact email is configured. Please use the report form.</p>
    <h2 class="text-lg font-semibold">Copyright / DMCA notices</h2>
    <p>Identify the copyrighted work, the exact content link, your name and contact details. Include a statement that you believe in good faith that the use is unauthorized, that the notice is accurate, and that you are the owner or authorized to act for them, under penalty of perjury. Include your physical or electronic signature.</p>
    <p>If you believe your content was removed by mistake, contact the operator with the removed link and the reason. The operator will explain the applicable counter-notice process.</p>
    <p>CSAM is removed immediately and reported to NCMEC or the relevant authorities. Do not attach or reproduce it in your report.</p>
  </main><SiteFooter /></div>
</template>
