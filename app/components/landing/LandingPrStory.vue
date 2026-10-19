<script setup lang="ts">
// Claude Code fixes a UI bug, drops before/after screenshots, and opens a pull request that links them.
// The reviewer reads the before/after in the description, opens Files changed, comments on the line, and approves.
import type { Beat } from "~/composables/useStoryboard"

const BEATS = [
  ["p.prompt", 2300], ["p.think", 1300], ["p.diff", 1900], ["p.drop", 1700], ["p.pr", 1600],
  ["p.open", 1200], ["p.read", 2600], ["p.tab", 1300], ["p.files", 2400], ["p.review", 2200], ["p.approve", 2600],
] as const satisfies readonly Beat[]
type Name = (typeof BEATS)[number][0]

const FRAMES = {
  terminal: { x: 0, y: 44, w: 500, h: 420 },
  pr: { x: 380, y: 0, w: 620, h: 500 },
}

// Claude Code's edit, as the terminal shows it.
const EDIT: { type: "ctx" | "del" | "add"; n: number; text: string }[] = [
  { type: "ctx", n: 18, text: "<p class=\"plan\">{{ plan }}</p>" },
  { type: "del", n: 19, text: "<p class=\"price whitespace-nowrap\">" },
  { type: "add", n: 19, text: "<p class=\"price text-balance\">" },
]

// GitHub's unified diff: old and new line numbers, then the line.
const DIFF: { old?: number; new?: number; type: "ctx" | "del" | "add"; text: string }[] = [
  { old: 16, new: 16, type: "ctx", text: "<template>" },
  { old: 17, new: 17, type: "ctx", text: "  <div class=\"card\">" },
  { old: 18, new: 18, type: "ctx", text: "    <p class=\"plan\">{{ plan }}</p>" },
  { old: 19, type: "del", text: "    <p class=\"price whitespace-nowrap\">{{ price }}</p>" },
  { new: 19, type: "add", text: "    <p class=\"price text-balance\">{{ price }}</p>" },
  { old: 20, new: 20, type: "ctx", text: "    <p class=\"note\">Billed yearly</p>" },
  { old: 21, new: 21, type: "ctx", text: "  </div>" },
]

const stage = useTemplateRef<HTMLElement>("stage")
const canvas = useTemplateRef<HTMLElement>("canvas")
const { beat, index, at } = useStoryboard(stage, BEATS, { still: "p.approve" })
const onPr = computed(() => at("p.open"))
const files = computed(() => at("p.files"))

// The reviewer's pointer: reads the before/after, then opens Files changed.
const TARGETS: Partial<Record<Name, string>> = { "p.read": "after", "p.tab": "files-tab", "p.files": "changed-line", "p.review": "changed-line" }
const ana = useCursorTarget(canvas, () => TARGETS[beat.value])
const click = computed(() => (beat.value === "p.tab" ? BEATS[index.value]![1] - 380 : null))
</script>

<template>
  <div ref="stage" aria-hidden="true">
    <LandingStage :size="[1000, 500]" :compact-size="[620, 500]" :grow="1.06">
      <template #default>
        <div ref="canvas" class="absolute inset-0">
          <LandingWindow title="claude — ~/acme/web" :frame="FRAMES.terminal" :state="onPr ? 'back' : 'front'" dark>
            <template #icon><BrainlessClaudeLogo class="h-2.5" /></template>
            <div class="flex h-full flex-col gap-3 p-4">
              <div class="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden [&>*]:shrink-0 [&>*]:[animation:pop-in_320ms_var(--ease-out)]">
                <BrainlessClaudeMessage v-if="at('p.think')" role="user">fix the pricing card overflow on mobile, open a PR with before/after</BrainlessClaudeMessage>
                <BrainlessClaudeThinking v-if="beat === 'p.think'" verb="Reproducing" />
                <BrainlessClaudeDiff
                  v-if="at('p.diff')"
                  file="app/components/PricingCard.vue"
                  summary="1 addition and 1 removal"
                  :lines="EDIT"
                />
                <BrainlessClaudeToolCall v-if="at('p.drop')" tool="drop - publish (MCP)" arg='title: "Pricing card: before/after", lifetime: "keep", share: "public", …' result="Published: drop.vitehub.dev/d/p7q2 (id=p7q2)" />
                <BrainlessClaudeToolCall v-if="at('p.pr')" tool="Bash" arg="gh pr create --fill" result="https://github.com/acme/web/pull/142" />
              </div>
              <BrainlessClaudePrompt>
                <LandingTyped v-if="beat === 'p.prompt'" text="fix the pricing card overflow on mobile, open a PR with before/after" :cps="34" :delay="300" />
              </BrainlessClaudePrompt>
            </div>
          </LandingWindow>

          <LandingWindow title="github.com/acme/web/pull/142" :frame="FRAMES.pr" :state="onPr ? 'front' : 'back'" :blank="!at('p.pr')" url>
            <div class="flex h-full flex-col overflow-hidden text-xs">
              <div class="px-5 pt-4">
                <p class="text-lg font-semibold tracking-tight text-highlighted">Fix pricing card overflow on mobile <span class="font-normal text-dimmed">#142</span></p>
                <div class="mt-2 flex items-center gap-2 text-muted">
                  <span class="flex items-center gap-1 rounded-full bg-inverted px-2 py-0.5 font-medium text-inverted"><UIcon name="i-ph-git-pull-request" class="size-3" />Open</span>
                  <span><span class="font-medium text-highlighted">maxi</span> wants to merge 1 commit into <span class="rounded bg-elevated px-1 font-mono">main</span> from <span class="rounded bg-elevated px-1 font-mono">fix/pricing-overflow</span></span>
                </div>
                <div class="mt-3 flex gap-4 border-b border-default">
                  <span class="-mb-px border-b-2 pb-2 transition-colors" :class="files ? 'border-transparent text-muted' : 'border-(--ui-text-highlighted) font-medium text-highlighted'">Conversation</span>
                  <span class="-mb-px pb-2 text-muted">Commits <span class="rounded-full bg-elevated px-1.5">1</span></span>
                  <span data-cursor="files-tab" class="-mb-px flex items-center gap-1 border-b-2 pb-2 transition-colors" :class="files ? 'border-(--ui-text-highlighted) font-medium text-highlighted' : 'border-transparent text-muted'">
                    Files changed <span class="rounded-full bg-elevated px-1.5">1</span>
                  </span>
                  <span class="ml-auto pb-2 font-mono"><span class="text-[#1a7f37] dark:text-[#3fb950]">+1</span> <span class="text-[#cf222e] dark:text-[#f85149]">−1</span></span>
                </div>
              </div>

              <!-- Conversation: the description, with the drop's before/after side by side. -->
              <div v-if="!files" class="min-h-0 flex-1 p-5 pt-4">
                <div class="rounded-lg border border-default">
                  <div class="flex items-center gap-2 border-b border-default bg-muted px-3 py-2">
                    <span class="grid size-4 place-items-center rounded-full bg-inverted text-[8px] font-semibold text-inverted">M</span>
                    <span class="font-medium text-highlighted">maxi</span><span class="text-muted">opened this with</span>
                    <AgentIcon name="Claude Code" kind="agent" class="size-3.5" /><span class="text-muted">Claude Code</span>
                  </div>
                  <div class="space-y-2.5 p-3 text-toned">
                    <p>Long prices wrap inside the card instead of running off it on narrow screens.</p>
                    <p><span class="font-semibold text-highlighted">Before / after:</span> <span class="underline decoration-(--ui-border-accented) underline-offset-2">drop.vitehub.dev/d/p7q2</span></p>
                    <div class="overflow-hidden rounded-md border border-default">
                      <div class="flex items-center gap-1.5 border-b border-default px-2.5 py-1.5 text-[11px]">
                        <DropMark class="h-3" /><span class="font-medium text-highlighted">pricing-card.md</span><span class="text-dimmed">· Drop</span>
                      </div>
                      <div class="grid grid-cols-2 divide-x divide-default">
                        <div v-for="side in ['before', 'after']" :key="side" :data-cursor="side" class="relative">
                          <span class="label-mono absolute top-2 left-2 z-10 text-[10px]">{{ side }}</span>
                          <LandingPricingShot :fixed="side === 'after'" class="h-44" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Files changed: GitHub's unified diff, with the review comment on the changed line. -->
              <div v-else class="min-h-0 flex-1 space-y-3 p-5 pt-4 [animation:fade-in_300ms_ease-out]">
                <div v-if="at('p.approve')" class="flex items-center gap-2 rounded-lg border border-default px-3 py-2 [animation:pop-in_360ms_var(--ease-out)]">
                  <span class="grid size-5 place-items-center rounded-full bg-[#1a7f37] text-white"><UIcon name="i-ph-check" class="size-3" /></span>
                  <span><span class="font-medium text-highlighted">ana</span> <span class="text-muted">approved these changes</span></span>
                </div>
                <div class="overflow-hidden rounded-lg border border-default font-mono text-[11px] leading-[1.7]">
                  <div class="flex items-center gap-2 border-b border-default bg-muted px-3 py-2 font-sans">
                    <UIcon name="i-ph-caret-down" class="size-3.5 text-muted" />
                    <span class="font-mono text-highlighted">app/components/PricingCard.vue</span>
                    <span class="ml-1 flex gap-px"><span class="size-2 bg-[#1a7f37]" /><span class="size-2 bg-[#cf222e]" /><span class="size-2 bg-accented" /><span class="size-2 bg-accented" /><span class="size-2 bg-accented" /></span>
                    <span class="ml-auto flex items-center gap-1 rounded border border-default px-1.5 text-muted"><span class="size-2.5 rounded-sm border border-(--ui-border-accented)" />Viewed</span>
                  </div>
                  <div class="bg-[#ddf4ff]/60 px-3 py-0.5 text-muted dark:bg-[#388bfd]/10">@@ -16,6 +16,6 @@</div>
                  <template v-for="line in DIFF" :key="`${line.old}-${line.new}`">
                    <div
                      class="grid grid-cols-[2.25rem_2.25rem_1rem_minmax(0,1fr)]"
                      :data-cursor="line.type === 'add' ? 'changed-line' : undefined"
                      :class="line.type === 'add' ? 'bg-[#e6ffec] dark:bg-[#2ea043]/15' : line.type === 'del' ? 'bg-[#ffebe9] dark:bg-[#f85149]/15' : ''"
                    >
                      <span class="pr-2 text-right text-dimmed select-none" :class="line.type === 'del' && 'bg-[#ffd7d5] dark:bg-[#f85149]/25'">{{ line.old ?? "" }}</span>
                      <span class="pr-2 text-right text-dimmed select-none" :class="line.type === 'add' && 'bg-[#ccffd8] dark:bg-[#2ea043]/25'">{{ line.new ?? "" }}</span>
                      <span class="text-center text-muted select-none">{{ line.type === "add" ? "+" : line.type === "del" ? "-" : "" }}</span>
                      <span class="truncate pr-3 text-highlighted">{{ line.text }}</span>
                    </div>
                    <div v-if="line.type === 'add' && at('p.review')" class="border-y border-default bg-default p-2.5 font-sans [animation:pop-in_360ms_var(--ease-out)]">
                      <div class="flex items-start gap-2 rounded-md border border-default p-2.5">
                        <span class="grid size-5 shrink-0 place-items-center rounded-full bg-elevated text-[9px] font-semibold text-highlighted">A</span>
                        <div>
                          <p><span class="font-medium text-highlighted">ana</span> <span class="text-dimmed">just now</span></p>
                          <p class="mt-0.5 text-toned">Checked the drop on my phone. Two lines, no overflow.</p>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </LandingWindow>

          <LandingCursor :x="ana.x" :y="ana.y" :shown="ana.shown" label="Ana" :click="click" :beat="beat" />
        </div>
      </template>
    </LandingStage>
  </div>
</template>
