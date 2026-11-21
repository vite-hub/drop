<script setup lang="ts">
const origin = useRequestURL().origin
</script>

<template>
  <a :href="origin">{{ origin.replace(/^https?:\/\//, "") }}</a>
</template>
