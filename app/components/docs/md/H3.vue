<script setup lang="ts">
defineProps<{ id?: string }>()
</script>

<template>
  <h3 :id="id" class="scroll-mt-20"><slot /></h3>
</template>
