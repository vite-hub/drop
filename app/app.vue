<script setup lang="ts">
// Link previews need an absolute image URL, so it follows whichever host serves Drop.
const origin = useRequestURL().origin
useSeoMeta({
  titleTemplate: title => (title && title !== "Drop" ? `${title} · Drop` : "Drop"),
  ogSiteName: "Drop",
  ogTitle: "Drop",
  ogDescription: "Review what your agents plan. Agents drop docs and small apps; you comment on the exact spot and send the feedback back.",
  ogImage: `${origin}/og.png`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: "Drop: review what your agents plan.",
  twitterCard: "summary_large_image",
})
</script>

<template>
  <UApp :toaster="{ position: 'bottom-center' }">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
