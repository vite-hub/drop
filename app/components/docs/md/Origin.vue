<script setup lang="ts">
// `:origin` in the docs' Markdown: this Drop's address, without `https://` when `bare` is set.
defineProps<{ bare?: boolean }>()
const origin = useRequestURL().origin
</script>

<template>
  <span>{{ bare ? origin.replace(/^https?:\/\//, "") : origin }}</span>
</template>
