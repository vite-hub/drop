<script setup lang="ts">
import { CopyButton, type CopyValue } from "vite-hub/ui"
import "#shared/copy-icon.css"

defineOptions({ inheritAttrs: false })
defineProps<{ value: CopyValue }>()
const notify = useNotify()

function failed() {
  reportClientError("copy", new Error("The browser refused a copy button's write"))
  notify.alert("Couldn't copy")
}
</script>

<template>
  <CopyButton v-bind="$attrs" :duration="COPY_MS" :value="value" @error="failed">
    <template v-if="$slots.default" #default><slot /></template>
  </CopyButton>
</template>
