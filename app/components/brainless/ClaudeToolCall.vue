<script setup lang="ts">
// Claude Code's collapsed tool line: ⏺ Tool(arg) and the ⎿ result under it.
// Ported from Brainless (MIT, see LICENSE); static here, without the disclosure.
const { status = "success" } = defineProps<{
  tool: string
  arg?: string
  result?: string
  status?: "success" | "error" | "pending"
}>()
const STATUS = { success: "#4ea96f", error: "#f7768e", pending: "#e0af68" }
</script>

<template>
  <div class="font-mono text-[13px] leading-[1.55]">
    <div class="flex min-w-0 items-baseline gap-2">
      <span aria-hidden="true" class="shrink-0" :style="{ color: STATUS[status] }">⏺</span>
      <span class="min-w-0 break-words">
        <span class="text-[#c0caf5]">{{ tool }}</span>
        <template v-if="arg !== undefined"
          ><span class="text-[#565f89]">(</span><span class="text-[#7dcfff]">{{ arg }}</span
          ><span class="text-[#565f89]">)</span></template
        >
      </span>
    </div>
    <div v-if="result" class="flex min-w-0 items-baseline gap-2 text-[#8b8fa3]">
      <span aria-hidden="true" class="invisible shrink-0">⏺</span>
      <span aria-hidden="true" class="shrink-0 text-[#565f89]">⎿</span>
      <span class="min-w-0 break-words">{{ result }}</span>
    </div>
  </div>
</template>
