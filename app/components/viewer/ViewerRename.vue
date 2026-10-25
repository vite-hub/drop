<script setup lang="ts">
// A drop's name, edited where it shows (a folder's list, its preview). It opens with the name picked, a file's
// extension left out as Finder does; Enter or leaving the field saves, Escape keeps the old name.
const props = defineProps<{ title: string; label: string }>()
const emit = defineEmits<{ done: [title: string | null] }>()
const value = ref(props.title)
const input = useTemplateRef("input")
let finished = false

onMounted(() => {
  const field = input.value
  if (!field) return
  field.focus()
  const dot = props.title.lastIndexOf(".")
  field.setSelectionRange(0, dot > 0 ? dot : props.title.length)
})

function finish(save: boolean) {
  if (finished) return
  finished = true
  const title = value.value.trim()
  emit("done", save && title && title !== props.title ? title : null)
}
</script>

<template>
  <!-- Its keys stay here: Escape would close the preview and the arrows walk the list otherwise. -->
  <input
    ref="input"
    v-model="value"
    :aria-label="label"
    class="w-full min-w-0 rounded-sm bg-default px-1 -mx-1 text-sm font-medium text-highlighted outline-none ring-2 ring-(--ui-border-inverted)"
    maxlength="160"
    @blur="finish(true)"
    @click.stop
    @keydown.enter.prevent="finish(true)"
    @keydown.esc.stop.prevent="finish(false)"
    @keydown.stop
  />
</template>
