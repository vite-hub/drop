<script setup lang="ts">
// vite-hub/ui's CopyButton (value, label, icon, size, variant, preload) on Drop's timing: the check holds for COPY_MS,
// as every other copy in Drop does. A copy the browser refuses says so in a toast, besides the button's own "Copy
// failed" for screen readers, and reaches the client-error log.
// Its icon swaps with vite-hub/ui's SwapIcon, so the button needs no stylesheet of its own.
import { CopyButton, type CopyValue } from "vite-hub/ui"

defineOptions({ inheritAttrs: false })
defineProps<{ value: CopyValue }>()
const notify = useNotify()

function failed() {
  reportClientError("copy", new Error("The browser refused a copy button's write"))
  notify.alert("Couldn't copy")
}
</script>

<template>
  <CopyButton v-bind="$attrs" :duration="COPY_MS" :value="value" @error="failed" />
</template>
