<script setup lang="ts">
// Claude Code fixes a UI bug, drops before/after screenshots, and opens a pull request that links them.
// The reviewer sees the change itself: the drop's before/after wipes across inside the PR.
import type { Beat } from "~/composables/useStoryboard"

const BEATS = [
  ["p.prompt", 2300], ["p.think", 1300], ["p.diff", 1900], ["p.drop", 1700], ["p.pr", 1600],
  ["p.open", 1500], ["p.compare", 3600], ["p.approve", 2600],
] as const satisfies readonly Beat[]

const FRAMES = {
  terminal: { x: 0, y: 36, w: 500, h: 404 },
  pr: { x: 390, y: 0, w: 610, h: 452 },
}

const stage = useTemplateRef<HTMLElement>("stage")
const { beat, at } = useStoryboard(stage, BEATS, { still: "p.approve" })
const onPr = computed(() => at("p.open"))
</script>

<template>
  <div ref="stage" aria-hidden="true">
    <LandingStage :size="[1000, 452]" :compact-size="[610, 452]">
      <template #default="{ compact }">
        <LandingWindow title="claude — ~/acme/web" :frame="FRAMES.terminal" :state="onPr ? 'back' : 'front'" :compact="compact" dark>
          <template #icon><BrainlessClaudeLogo class="h-2.5" /></template>
          <div class="flex h-full flex-col gap-3 p-4">
            <div class="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden [&>*]:shrink-0 [&>*]:[animation:pop-in_320ms_var(--ease-out)]">
              <BrainlessClaudeMessage v-if="at('p.think')" role="user">fix the pricing card overflow on mobile, open a PR with before/after</BrainlessClaudeMessage>
              <BrainlessClaudeThinking v-if="beat === 'p.think'" verb="Reproducing" />
              <BrainlessClaudeDiff
                v-if="at('p.diff')"
                file="app/components/PricingCard.vue"
                summary="1 addition and 1 removal"
                :lines="[
                  { type: 'ctx', n: 18, text: '<div class=&quot;card&quot;>' },
                  { type: 'del', n: 19, text: '  <p class=&quot;price whitespace-nowrap&quot;>' },
                  { type: 'add', n: 19, text: '  <p class=&quot;price text-balance&quot;>' },
                ]"
              />
              <BrainlessClaudeToolCall v-if="at('p.drop')" tool="drop - create_doc (MCP)" arg='title: "Pricing card: before/after", …' result="Dropped pricing-card.md · anyone can comment" />
              <BrainlessClaudeToolCall v-if="at('p.pr')" tool="Bash" arg="gh pr create --fill" result="github.com/acme/web/pull/142" />
            </div>
            <BrainlessClaudePrompt>
              <LandingTyped v-if="beat === 'p.prompt'" text="fix the pricing card overflow on mobile, open a PR with before/after" :cps="34" :delay="300" />
            </BrainlessClaudePrompt>
          </div>
        </LandingWindow>

        <LandingWindow title="github.com/acme/web/pull/142" :frame="FRAMES.pr" :state="onPr ? 'front' : at('p.pr') ? 'back' : 'hidden'" :compact="compact" url>
          <div class="flex h-full flex-col gap-3 overflow-hidden p-5 text-xs">
            <p class="text-lg font-semibold tracking-tight text-highlighted">Fix pricing card overflow on mobile <span class="font-normal text-dimmed">#142</span></p>
            <div class="flex items-center gap-2 text-muted">
              <span class="flex items-center gap-1 rounded-full bg-inverted px-2 py-0.5 font-medium text-inverted"><UIcon name="i-lucide-git-pull-request" class="size-3" />Open</span>
              <span><span class="font-medium text-highlighted">claude-code</span> wants to merge 1 commit into <span class="rounded bg-elevated px-1 font-mono">main</span></span>
            </div>
            <div class="rounded-lg border border-default">
              <div class="flex items-center gap-2 border-b border-default bg-muted px-3 py-2">
                <AgentIcon name="Claude Code" kind="agent" class="size-3.5" />
                <span class="font-medium text-highlighted">claude-code</span><span class="text-muted">commented</span>
              </div>
              <div class="space-y-2.5 p-3 text-toned">
                <p>Long prices wrap inside the card instead of running off it on narrow screens.</p>
                <p><span class="font-semibold text-highlighted">Before / after:</span> <span class="underline decoration-(--ui-border-accented) underline-offset-2">drop.vitehub.dev/d/p7q2</span></p>

                <!-- The drop's before/after, embedded in the PR. -->
                <div class="overflow-hidden rounded-md border border-default">
                  <div class="flex items-center gap-1.5 border-b border-default px-2.5 py-1.5 text-[11px]">
                    <DropMark class="h-3" /><span class="font-medium text-highlighted">pricing-card.md</span><span class="text-dimmed">· Drop</span>
                  </div>
                  <div class="relative h-40 bg-muted">
                    <LandingPricingShot class="absolute inset-0" />
                    <div v-if="at('p.compare')" :key="String(at('p.compare'))" class="absolute inset-0 [animation:wipe_2.6s_var(--ease-out)_400ms_both]">
                      <LandingPricingShot fixed class="absolute inset-0" />
                    </div>
                    <span v-if="at('p.compare')" class="absolute inset-y-0 w-0.5 bg-inverted [animation:wipe-handle_2.6s_var(--ease-out)_400ms_both]" />
                    <span class="label-mono absolute top-2 left-2 rounded bg-default/80 px-1.5 py-0.5 text-[10px]">{{ at("p.compare") ? "After" : "Before" }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="at('p.approve')" class="flex items-center gap-2 rounded-lg border border-default px-3 py-2 [animation:pop-in_360ms_var(--ease-out)]">
              <span class="grid size-5 place-items-center rounded-full bg-inverted text-inverted"><UIcon name="i-lucide-check" class="size-3" /></span>
              <span><span class="font-medium text-highlighted">Ana</span> <span class="text-muted">approved: looks right on my phone</span></span>
            </div>
          </div>
        </LandingWindow>
      </template>
    </LandingStage>
  </div>
</template>
