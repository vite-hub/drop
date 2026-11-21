<script setup lang="ts">
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
