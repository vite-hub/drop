<script setup lang="ts">
// A suggested edit as the doc draws it (comark-comments' redline): the quote struck through in red, then the words
// that replace it in green. An empty suggestion deletes the quote. <del> and <ins> are silent in most screen readers,
// so hidden words say what the change is. `inline` draws it inside a line of text, such as a row of the comment list.
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
