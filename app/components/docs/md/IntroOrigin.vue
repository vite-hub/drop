<script setup lang="ts">
// `:intro-origin`: a link to this Drop's address, shown without `https://`.
const origin = useRequestURL().origin
</script>

<template>
  <a :href="origin">{{ origin.replace(/^https?:\/\//, "") }}</a>
</template>
