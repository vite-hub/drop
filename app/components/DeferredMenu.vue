<script setup lang="ts">
// A UDropdownMenu that mounts on its trigger's first click instead of with the page, already open. Each closed menu
// still builds Reka's whole menu tree, and the Drops page's rows and tree items hold one or two each: together they
// took about a third of the page's server render. Enter and Space click the trigger too, so keyboards open it the same.
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
