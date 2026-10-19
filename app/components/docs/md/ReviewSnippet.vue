<script setup lang="ts">
import { reviewSnippet } from "#shared/review"

// `::review-snippet`: a code block with the script tag that adds Drop's Comment button to a site, from the same snippet the app shows.
const code = reviewSnippet(useRequestURL().origin)
</script>

<template>
  <AgentsCodeBlock :code="code" />
</template>
