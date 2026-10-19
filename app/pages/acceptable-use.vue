<script setup lang="ts">
// Legal template. The instance owner must review and adapt this source before offering a public service.
useSeoMeta({ title: "Acceptable use", description: "What you may not upload or share on Drop: phishing, malware, spam, illegal content, and copyright infringement." })
</script>
<template>
  <div class="flex min-h-dvh flex-col"><SiteHeader /><main class="mx-auto w-full flex-1 max-w-2xl space-y-5 px-6 py-12">
    <h1 class="text-2xl font-semibold">Acceptable use</h1>
    <p>Do not upload or share phishing pages, malware, crypto drainers, spam, illegal content, or content that infringes copyright. Do not use Drop to steal credentials, deceive people, or evade an account suspension.</p>
    <p>Child sexual abuse material is prohibited. CSAM is removed immediately and reported to NCMEC or the relevant authorities. Do not send copies in a report.</p>
    <p>The operator may quarantine content and ban accounts that break these rules.</p>
    <p><NuxtLink to="/report" class="underline">Report a drop</NuxtLink> or read the <NuxtLink to="/abuse" class="underline">copyright and abuse contact</NuxtLink> page.</p>
  </main><SiteFooter /></div>
</template>
