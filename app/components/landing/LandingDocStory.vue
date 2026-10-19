<script setup lang="ts">
// Claude Code reads the team's folders and drops a plan where the folder's description says it goes. In the browser
// you open the editor, Ben and Lea join, Ben adds a line, you publish v2, and History shows what v2 changed.
import type { Beat } from "~/composables/useStoryboard"

const BEATS = [
  ["t.prompt", 2300], ["t.folders", 1600], ["t.drop", 2100],
  ["e.open", 1600], ["e.edit", 1300], ["e.type", 2900], ["e.done", 1700],
  ["h.open", 1700], ["h.diff", 2900], ["h.hold", 2200],
] as const satisfies readonly Beat[]
type Name = (typeof BEATS)[number][0]

const FRAMES = {
  terminal: { x: 0, y: 44, w: 470, h: 412 },
  browser: { x: 330, y: 0, w: 670, h: 500 },
}

const ROLLOUT = ["Move internal accounts first", "Then 10% of teams, then everyone"]
const ADDED = "Freeze plan changes on Nov 2"

const stage = useTemplateRef<HTMLElement>("stage")
const canvas = useTemplateRef<HTMLElement>("canvas")
const { beat, index, at } = useStoryboard(stage, BEATS, { still: "h.hold" })
const onBrowser = computed(() => at("e.open"))
const editing = computed(() => at("e.edit") && !at("e.done"))
const v2 = computed(() => at("e.done"))
const history = computed(() => at("h.open"))
const diff = computed(() => at("h.diff"))

// Your pointer, and the beats that end in a click where it rests: the next beat shows what the click did.
const TARGETS: Partial<Record<Name, string>> = { "e.open": "edit", "e.edit": "publish", "e.type": "publish", "e.done": "history", "h.open": "v2", "h.diff": "v2", "h.hold": "v2" }
const CLICKS: Partial<Record<Name, true>> = { "e.open": true, "e.type": true, "e.done": true, "h.open": true }
const you = useCursorTarget(canvas, () => TARGETS[beat.value])
const click = computed(() => (CLICKS[beat.value] ? BEATS[index.value]![1] - 380 : null))
</script>

<template>
  <div ref="stage" aria-hidden="true">
    <LandingStage :size="[1000, 500]" :compact-size="[670, 500]" :grow="1.06">
      <template #default>
        <div ref="canvas" class="absolute inset-0">
          <LandingWindow title="claude — ~/acme/billing" :frame="FRAMES.terminal" :state="onBrowser ? 'back' : 'front'" dark>
            <template #icon><BrainlessClaudeLogo class="h-2.5" /></template>
            <div class="flex h-full flex-col gap-3 p-4">
              <div class="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden [&>*]:shrink-0 [&>*]:[animation:pop-in_320ms_var(--ease-out)]">
                <BrainlessClaudeMessage v-if="at('t.folders')" role="user">plan the billing migration and drop it for the team</BrainlessClaudeMessage>
                <BrainlessClaudeToolCall v-if="at('t.folders')" tool="drop - list_folders (MCP)" result="Plans: &quot;One doc per project. Goal, rollout, risks.&quot;" />
                <template v-if="at('t.drop')">
                  <BrainlessClaudeToolCall tool="drop - publish (MCP)" arg="folder: &quot;Plans&quot;, title: &quot;Billing migration&quot;, lifetime: &quot;review&quot;" result="Published: drop.vitehub.dev/d/b1lm (id=b1lm)" />
                  <BrainlessClaudeMessage>It's in Plans, laid out the way the folder asks. The team can open it now.</BrainlessClaudeMessage>
                </template>
              </div>
              <BrainlessClaudePrompt>
                <LandingTyped v-if="beat === 't.prompt'" text="plan the billing migration and drop it for the team" :cps="34" :delay="300" />
              </BrainlessClaudePrompt>
            </div>
          </LandingWindow>

          <LandingWindow title="drop.vitehub.dev/d/b1lm/billing-migration" :frame="FRAMES.browser" :state="onBrowser ? 'front' : 'back'" :blank="!at('t.drop')" url>
            <div class="relative flex h-full flex-col">
              <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default px-4 text-sm">
                <DropMark class="h-3.5 shrink-0" />
                <span class="text-muted">Plans</span><span class="text-dimmed">/</span>
                <span class="font-medium text-highlighted">Billing migration</span>
                <span :key="String(v2)" class="rounded-md border border-default px-1.5 py-0.5 font-mono text-[11px] text-muted [animation:pop-in_400ms_var(--ease-out)]">{{ v2 ? "v2" : "v1" }}</span>
                <div class="ml-auto flex items-center gap-1">
                  <div v-if="at('e.type') && !at('e.done')" class="mr-2 flex -space-x-1.5">
                    <span class="grid size-6 place-items-center rounded-full bg-sky-500 text-[10px] font-semibold text-white ring-2 ring-(--ui-bg) [animation:pop-in_400ms_var(--ease-out)_both]">B</span>
                    <span class="grid size-6 place-items-center rounded-full bg-amber-500 text-[10px] font-semibold text-white ring-2 ring-(--ui-bg) [animation:pop-in_400ms_var(--ease-out)_200ms_both]">L</span>
                  </div>
                  <span data-cursor="edit" class="grid size-7 place-items-center rounded-md text-muted" :class="editing && 'bg-elevated text-highlighted'"><UIcon name="i-ph-pencil-simple" class="size-4" /></span>
                  <span class="grid size-7 place-items-center rounded-md text-muted" :class="!history && !editing && 'bg-elevated text-highlighted'"><UIcon name="i-ph-chat-circle" class="size-4" /></span>
                  <span data-cursor="history" class="grid size-7 place-items-center rounded-md text-muted" :class="history && 'bg-elevated text-highlighted'"><UIcon name="i-ph-clock-counter-clockwise" class="size-4" /></span>
                  <span class="ml-1 flex items-center gap-1.5 rounded-md border border-default px-2 py-1 text-xs text-highlighted"><UIcon name="i-ph-users" class="size-3.5" /> Team</span>
                </div>
              </div>

              <!-- The live editor's bar: who's in the draft, and Publish. -->
              <div v-if="editing" class="flex h-9 shrink-0 items-center gap-2 border-b border-default bg-muted px-4 text-xs [animation:fade-in_300ms_ease-out]">
                <UIcon name="i-ph-pencil-simple" class="size-3.5 text-muted" />
                <span class="text-highlighted">Editing together</span>
                <span class="text-dimmed">· {{ at("e.type") ? "Draft saved" : "Draft" }}</span>
                <span data-cursor="publish" class="ml-auto rounded-md bg-inverted px-2.5 py-1 text-[11px] font-medium text-inverted">Publish</span>
              </div>

              <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_13.5rem]">
                <!-- What v2 changed, in place of the document. -->
                <div v-if="diff" class="min-w-0 px-7 py-6 text-[13px] leading-relaxed [animation:fade-in_300ms_ease-out]">
                  <p class="flex items-center gap-2 text-xs text-muted"><UIcon name="i-ph-arrow-left" class="size-3.5" /> What changed in <span class="font-mono text-highlighted">v2</span></p>
                  <h4 class="mt-5 text-sm font-semibold text-highlighted">Rollout</h4>
                  <ul class="mt-1 space-y-0.5 text-toned">
                    <li v-for="line in ROLLOUT" :key="line" class="rounded-sm px-2">• {{ line }}</li>
                    <li class="rounded-sm bg-[#e6ffec] px-2 text-highlighted [animation:pop-in_360ms_var(--ease-out)] dark:bg-[#2ea043]/15"><span class="mr-1 font-mono text-[#1a7f37] dark:text-[#3fb950]">+</span>{{ ADDED }}</li>
                  </ul>
                  <h4 class="mt-5 text-sm font-semibold text-highlighted">Risks</h4>
                  <ul class="mt-1 space-y-0.5 text-toned">
                    <li class="rounded-sm bg-[#ffebe9] px-2 dark:bg-[#f85149]/15"><span class="mr-1 font-mono text-[#cf222e] dark:text-[#f85149]">−</span><span class="line-through decoration-[#cf222e]/50">Invoices may double-send.</span></li>
                    <li class="rounded-sm bg-[#e6ffec] px-2 text-highlighted dark:bg-[#2ea043]/15"><span class="mr-1 font-mono text-[#1a7f37] dark:text-[#3fb950]">+</span>Invoices may double-send. Pause the invoice job during the switch.</li>
                  </ul>
                </div>

                <article v-else class="min-w-0 px-7 py-6 text-[13px] leading-relaxed text-toned">
                  <h3 class="text-xl font-semibold tracking-tight text-highlighted">Billing migration</h3>
                  <p class="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                    <template v-if="v2">Ben, Lea, and you · v2</template>
                    <template v-else><AgentIcon name="Claude Code" kind="agent" class="size-3" /> Claude Code · v1</template>
                  </p>
                  <h4 class="mt-5 text-sm font-semibold text-highlighted">Goal</h4>
                  <p class="mt-1">Move every account to usage-based billing by December.</p>
                  <h4 class="mt-5 text-sm font-semibold text-highlighted">Rollout</h4>
                  <ul class="mt-1 list-disc space-y-0.5 pl-5">
                    <li v-for="line in ROLLOUT" :key="line">{{ line }}</li>
                    <li v-if="at('e.type')">
                      <span class="relative">
                        <LandingTyped v-if="!at('e.done')" :text="ADDED" :cps="18" :delay="500" /><template v-else>{{ ADDED }}</template>
                        <span v-if="editing" class="absolute -right-0.5 -bottom-0.5 h-[1.15em] w-0.5 bg-sky-500"><span class="absolute bottom-full left-0 rounded-sm rounded-bl-none bg-sky-500 px-1 text-[9px] leading-tight font-medium whitespace-nowrap text-white">Ben</span></span>
                      </span>
                    </li>
                  </ul>
                  <h4 class="mt-5 text-sm font-semibold text-highlighted">Risks</h4>
                  <ul class="mt-1 list-disc pl-5">
                    <li>
                      Invoices may double-send.<template v-if="at('e.type')"><span class="[animation:fade-in_400ms_ease-out_1.6s_both]"> Pause the invoice job during the switch.</span></template>
                      <span v-if="editing && at('e.type')" class="relative inline-block h-[1.15em] w-0.5 translate-y-0.5 bg-amber-500 [animation:fade-in_200ms_ease-out_600ms_both]"><span class="absolute bottom-full left-0 rounded-sm rounded-bl-none bg-amber-500 px-1 text-[9px] leading-tight font-medium whitespace-nowrap text-white">Lea</span></span>
                    </li>
                  </ul>
                  <p v-if="at('e.done') && !history" class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-default bg-default px-3 py-2 text-xs text-highlighted shadow-lg [animation:pop-in_360ms_var(--ease-out)]">
                    <UIcon name="i-ph-check-circle" class="size-4" /> Published v2
                  </p>
                </article>

                <aside class="flex min-w-0 flex-col border-l border-default bg-muted/50">
                  <div class="flex h-10 shrink-0 items-center gap-2 border-b border-default px-3 text-xs">
                    <span class="font-medium text-highlighted">{{ history ? "History" : "Comments" }}</span>
                    <span v-if="!history" class="font-mono text-[11px] text-dimmed tabular-nums">1</span>
                  </div>
                  <ol v-if="history" class="p-2 text-xs [animation:fade-in_300ms_ease-out]">
                    <li data-cursor="v2" class="flex gap-2.5 rounded-md p-2" :class="diff && 'bg-elevated'">
                      <span class="mt-1 size-2 shrink-0 rounded-full bg-inverted" />
                      <span class="min-w-0">
                        <span class="flex items-center gap-1.5"><span class="font-mono text-muted">v2</span><span class="rounded bg-elevated px-1 text-[10px] text-muted">Viewing</span></span>
                        <span class="mt-0.5 block text-highlighted">Freeze date, invoice job</span>
                        <span class="block text-dimmed">Ben, Lea, and you · just now</span>
                      </span>
                    </li>
                    <li class="flex gap-2.5 rounded-md p-2">
                      <span class="mt-1 size-2 shrink-0 rounded-full bg-accented" />
                      <span class="min-w-0">
                        <span class="font-mono text-muted">v1</span>
                        <span class="mt-0.5 block text-highlighted">First draft</span>
                        <span class="flex items-center gap-1 text-dimmed"><AgentIcon name="Claude Code" kind="agent" class="size-3" /> Claude Code · 1 comment</span>
                      </span>
                    </li>
                  </ol>
                  <div v-else class="space-y-2 p-2.5">
                    <div class="rounded-lg border border-default bg-default p-2.5">
                      <div class="flex items-center gap-1.5">
                        <span class="grid size-4 place-items-center rounded-full bg-inverted text-[9px] font-semibold text-inverted">1</span>
                        <span class="text-xs font-medium text-highlighted">Ana</span>
                      </div>
                      <p class="mt-1 text-xs text-toned">What happens to annual plans?</p>
                      <p v-if="v2" class="mt-1.5 text-[10px] text-dimmed [animation:fade-in_400ms_ease-out]">Still open in v2</p>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </LandingWindow>

          <LandingCursor :x="you.x" :y="you.y" :shown="you.shown" label="You" :click="click" :beat="beat" />
        </div>
      </template>
    </LandingStage>
  </div>
</template>
