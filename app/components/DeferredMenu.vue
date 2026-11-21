<script setup lang="ts">
import type { DropdownMenuItem, DropdownMenuProps } from "@nuxt/ui"

const { items, content } = defineProps<{
  items: DropdownMenuItem[] | DropdownMenuItem[][]
  content?: DropdownMenuProps["content"]
}>()
const mounted = ref(false)
const open = ref(false)

function first() {
  mounted.value = true
  open.value = true
}
</script>

<template>
  <UDropdownMenu v-if="mounted" v-model:open="open" :content="content" :items="items"><slot /></UDropdownMenu>
  <span v-else class="contents" @click="first"><slot /></span>
</template>
