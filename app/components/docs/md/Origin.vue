<script setup lang="ts">
defineProps<{ bare?: boolean }>()
const origin = useRequestURL().origin
</script>

<template>
  <span>{{ bare ? origin.replace(/^https?:\/\//, "") : origin }}</span>
</template>
