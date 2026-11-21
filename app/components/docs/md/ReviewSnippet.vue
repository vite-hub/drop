<script setup lang="ts">
import { reviewSnippet } from "#shared/review"

const code = reviewSnippet(useRequestURL().origin)
</script>

<template>
  <AgentsCodeBlock :code="code" />
</template>
