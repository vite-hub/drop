<script setup lang="ts">
defineProps<{ quote: string; suggestion: string; inline?: boolean }>()
</script>

<template>
  <component :is="inline ? 'span' : 'p'" :class="inline ? undefined : 'line-clamp-4 text-sm leading-relaxed'">
    <span class="sr-only">{{ suggestion ? "Replace" : "Delete" }} </span>
    <del class="redline-del px-0.5">{{ quote }}</del>
    <template v-if="suggestion">
      <span class="sr-only"> with</span>
      <ins class="ml-0.5 redline-ins px-0.5">{{ suggestion }}</ins>
    </template>
  </component>
</template>
