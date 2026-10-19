<script setup lang="ts">
import { PLAN_AUTHORING_GUIDE } from "#shared/plan-runtime"

// `::plan-rules`: the rules agents follow for rich HTML plans, from the same text Drop gives them.
</script>

<template>
  <ul>
    <li v-for="rule in PLAN_AUTHORING_GUIDE.split('\n')" :key="rule">{{ rule }}</li>
  </ul>
</template>
