<script setup lang="ts">
// Claude Code's inline edit hunk: ⏺ Update(file), the ⎿ summary, and tinted +/- rows.
// Ported from Brainless (MIT, see LICENSE).
type DiffLine = { type: "add" | "del" | "ctx"; n?: number; text: string }
defineProps<{ file: string; summary?: string; lines: DiffLine[] }>()
const BG = { add: "rgba(78,169,111,.12)", del: "rgba(247,118,142,.14)", ctx: "transparent" }
const MARK = { add: "+", del: "-", ctx: " " }
const MARK_COLOR = { add: "#4ea96f", del: "#f7768e", ctx: "#565f89" }
</script>

<template>
  <div class="min-w-0 font-mono text-[13px] leading-[1.55]">
    <div class="flex min-w-0 items-baseline gap-x-2">
      <span aria-hidden="true" class="shrink-0 text-[#4ea96f]">⏺</span>
      <span class="min-w-0 break-all"
        ><span class="text-[#c0caf5]">Update</span><span class="text-[#565f89]">(</span
        ><span class="text-[#7dcfff]">{{ file }}</span
        ><span class="text-[#565f89]">)</span></span
      >
    </div>
    <div v-if="summary" class="flex min-w-0 items-baseline gap-2 text-[#8b8fa3]">
      <span aria-hidden="true" class="invisible shrink-0">⏺</span>
      <span aria-hidden="true" class="shrink-0 text-[#565f89]">⎿</span>
      <span class="min-w-0 break-words">{{ summary }}</span>
    </div>
    <pre
      class="mt-1 min-w-0 overflow-hidden border border-[#202022] bg-[#101010] py-1.5 pr-3 pl-2"
    ><div v-for="(line, index) in lines" :key="index" class="flex min-w-0" :style="{ background: BG[line.type] }"><span class="w-8 shrink-0 pr-2 text-right text-[#3b3f52] select-none">{{ line.n ?? "" }}</span><span class="w-3 shrink-0 select-none" :style="{ color: MARK_COLOR[line.type] }">{{ MARK[line.type] }}</span><span class="min-w-0 truncate" :class="line.type === 'ctx' ? 'text-[#8b8fa3]' : 'text-[#c0caf5]'"><span v-if="line.type !== 'ctx'" class="sr-only">{{ line.type === "add" ? "added: " : "removed: " }}</span>{{ line.text }}</span></div></pre>
  </div>
</template>
