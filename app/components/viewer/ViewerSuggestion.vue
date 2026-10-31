<script setup lang="ts">
// A suggested edit as the doc draws it (comark-comments' redline): the quote struck through in red, then the words
// that replace it in green. An empty suggestion deletes the quote.
defineProps<{ quote: string; suggestion: string }>()
</script>

<template>
  <p class="line-clamp-4 text-sm leading-relaxed">
    <del class="rounded-sm bg-error/10 px-0.5 text-error decoration-error/70 box-decoration-clone">{{ quote }}</del>
    <ins
      v-if="suggestion"
      class="ml-0.5 rounded-sm bg-success/10 px-0.5 text-success no-underline box-decoration-clone"
      >{{ suggestion }}</ins
    >
  </p>
</template>
