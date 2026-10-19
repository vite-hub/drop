<script setup lang="ts">
import type { Node } from "@comark/vue"

// A code block in the docs is a copyable snippet. `$ORIGIN` in it becomes this Drop's address, so commands paste as-is.
const props = defineProps<{ __node: Node }>()
const origin = useRequestURL().origin
// SAFETY: an element node is [tag, attributes, ...children], so what follows its first two entries are child nodes.
const text = (node: Node): string =>
  textValue(node) ??
  (Array.isArray(node)
    ? node
        .slice(2)
        .map((child) => text(child as Node))
        .join("")
    : "")
const code = computed(() => text(props.__node).replace(/\n$/, "").replaceAll("$ORIGIN", origin))
</script>

<template>
  <AgentsCodeBlock :code="code" />
</template>
