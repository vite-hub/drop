<script setup lang="ts">
// The loop on the landing page: Claude Code drops a launch plan linked to its pull request, you comment on one line,
// Claude Code reads the comment and publishes v2, and the line and the comment show what changed.
import type { Beat } from "~/composables/useStoryboard"

const BEATS = [
  ["t.prompt", 2600],
  ["t.drop", 2200],
  ["b.open", 1500],
  ["b.select", 1500],
  ["b.comment", 2600],
  ["b.posted", 1300],
  ["t.fix", 2200],
  ["t.publish", 2400],
  ["b.v2", 1800],
  ["b.hold", 2600],
] as const satisfies readonly Beat[]
type Name = (typeof BEATS)[number][0]

const FRAMES = {
  terminal: { x: 0, y: 70, w: 450, h: 420 },
  browser: { x: 300, y: 0, w: 740, h: 540 },
}

const LINE_V1 = "Public launch on Nov 4"
const LINE_V2 = "Public launch on Nov 9, after the billing freeze"
const COMMENT = "Nov 4 is inside the billing freeze. Can we move it?"

const stage = useTemplateRef<HTMLElement>("stage")
const canvas = useTemplateRef<HTMLElement>("canvas")
const { beat, index, at } = useStoryboard(stage, BEATS, { still: "b.hold" })
const onBrowser = computed(() => at("b.open") && !(at("t.fix") && !at("b.v2")))
const selected = computed(() => at("b.select"))
const composing = computed(() => beat.value === "b.comment")
const posted = computed(() => at("b.posted"))
const v2 = computed(() => at("b.v2"))

// Your pointer, and the beats that end in a click where it rests: the next beat shows what the click did.
const TARGETS: Partial<Record<Name, string>> = {
  "b.open": "line",
  "b.select": "line",
  "b.comment": "send",
  "b.posted": "send",
  "b.v2": "line",
  "b.hold": "line",
}
const CLICKS: Partial<Record<Name, true>> = { "b.select": true, "b.comment": true }
const you = useCursorTarget(canvas, () => (onBrowser.value ? TARGETS[beat.value] : null))
const click = computed(() => (CLICKS[beat.value] ? BEATS[index.value]![1] - 380 : null))
</script>

<template>
  <div ref="stage" aria-hidden="true">
    <LandingStage :size="[1040, 540]" :compact-size="[740, 540]">
      <template #default>
        <div ref="canvas" class="absolute inset-0">
          <LandingWindow
            title="claude — ~/acme/web"
            :frame="FRAMES.terminal"
            :state="onBrowser ? 'back' : 'front'"
            dark
          >
            <template #icon><BrainlessClaudeLogo class="h-2.5" /></template>
            <div class="flex h-full flex-col gap-3 p-4">
              <div
                class="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden [&>*]:shrink-0 [&>*]:[animation:pop-in_320ms_var(--ease-out)]"
              >
                <template v-if="at('t.drop')">
                  <BrainlessClaudeMessage role="user">write the launch plan and drop it</BrainlessClaudeMessage>
                  <BrainlessClaudeToolCall
                    tool="drop - publish (MCP)"
                    arg='title: "Launch plan", resources: ["PR #412"]'
                    result="Published: drop.vitehub.dev/d/l4p2"
                  />
                  <BrainlessClaudeMessage>Here's the plan, linked to PR #412.</BrainlessClaudeMessage>
                </template>
                <template v-if="at('t.publish')">
                  <BrainlessClaudeMessage role="user">fix the comments on the launch plan</BrainlessClaudeMessage>
                  <BrainlessClaudeToolCall tool="drop - read_drop (MCP)" arg='"l4p2"' result="1 open comment" />
                  <BrainlessClaudeToolCall
                    tool="drop - publish (MCP)"
                    arg='previous: "l4p2", resolves: [1]'
                    result="Published v2"
                  />
                </template>
              </div>
              <BrainlessClaudePrompt>
                <LandingTyped
                  v-if="beat === 't.prompt'"
                  text="write the launch plan and drop it"
                  :cps="30"
                  :delay="300"
                />
                <LandingTyped
                  v-else-if="beat === 't.fix'"
                  text="fix the comments on the launch plan"
                  :cps="30"
                  :delay="300"
                />
              </BrainlessClaudePrompt>
            </div>
          </LandingWindow>

          <LandingWindow
            title="drop.vitehub.dev/d/l4p2/launch-plan"
            :frame="FRAMES.browser"
            :state="onBrowser ? 'front' : 'back'"
            :blank="!at('t.drop')"
            url
          >
            <div class="flex h-full flex-col">
              <!-- The viewer's header: where it lives, who can open it, the pull request it belongs to. -->
              <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default px-4 text-sm">
                <DropMark class="h-3.5 shrink-0" />
                <span class="text-muted">Plans</span><span class="text-dimmed">/</span>
                <span class="font-medium text-highlighted">Launch plan</span>
                <span
                  :key="String(v2)"
                  class="rounded-md border border-default px-1.5 py-0.5 font-mono text-[11px] text-muted [animation:pop-in_400ms_var(--ease-out)]"
                  >{{ v2 ? "v2" : "v1" }}</span
                >
                <span class="flex items-center gap-1 rounded-md bg-elevated px-1.5 py-0.5 text-[11px] text-muted"
                  ><UIcon name="i-mingcute-group-2-line" class="size-3" /> Team</span
                >
                <span class="ml-1 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted"
                  ><UIcon name="i-simple-icons-github" class="size-3.5" /> PR #412</span
                >
                <div class="ml-auto flex items-center gap-1">
                  <span
                    class="flex h-7 items-center gap-1 rounded-md px-1.5 text-muted"
                    :class="posted && 'bg-elevated text-highlighted'"
                    ><UIcon name="i-mingcute-chat-1-line" class="size-4" /><span
                      v-if="posted && !v2"
                      class="font-mono text-[11px] tabular-nums [animation:pop-in_300ms_var(--ease-out)]"
                      >1</span
                    ></span
                  >
                  <span class="grid size-7 place-items-center rounded-md text-muted"
                    ><UIcon name="i-mingcute-history-line" class="size-4"
                  /></span>
                  <span class="ml-1 rounded-md bg-inverted px-2.5 py-1 text-xs font-medium text-inverted">Share</span>
                </div>
              </div>

              <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_14rem]">
                <article class="relative min-w-0 px-8 py-7 text-[13px] leading-relaxed text-toned">
                  <h3 class="text-xl font-semibold tracking-tight text-highlighted">Launch plan</h3>
                  <p class="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                    <AgentIcon name="Claude Code" kind="agent" class="size-3" /> Claude Code ·
                    {{ v2 ? "v2, just now" : "v1" }}
                  </p>
                  <h4 class="mt-5 text-sm font-semibold text-highlighted">Goal</h4>
                  <p class="mt-1">Usage-based pricing for every team.</p>
                  <h4 class="mt-5 text-sm font-semibold text-highlighted">Timeline</h4>
                  <ul class="mt-1 list-disc space-y-0.5 pl-5">
                    <li>Beta for 50 teams on Oct 28</li>
                    <li>
                      <span
                        v-if="v2"
                        :key="'v2'"
                        class="rounded-sm bg-[#e6ffec] px-1 text-highlighted [animation:pop-in_360ms_var(--ease-out)] dark:bg-[#2ea043]/15"
                        data-cursor="line"
                        >{{ LINE_V2 }}</span
                      >
                      <span v-else class="relative rounded-sm px-0.5" data-cursor="line"
                        ><span
                          v-if="selected"
                          class="absolute inset-0 -z-0 rounded-sm bg-amber-300/40 [animation:wipe_500ms_ease-out] dark:bg-amber-400/25"
                        /><span class="relative">{{ LINE_V1 }}</span
                        ><span
                          v-if="posted"
                          class="absolute -top-2 -right-3 grid size-4 place-items-center rounded-full bg-inverted text-[9px] font-semibold text-inverted [animation:pop-in_300ms_var(--ease-out)]"
                          >1</span
                        ></span
                      >
                    </li>
                    <li>Docs and changelog the same day</li>
                  </ul>
                  <h4 class="mt-5 text-sm font-semibold text-highlighted">Risks</h4>
                  <p class="mt-1">Invoices may double-send during the switch.</p>

                  <!-- The comment box that opens on a selection. -->
                  <div
                    v-if="composing"
                    class="absolute top-[14.75rem] left-14 w-64 rounded-lg border border-default bg-default p-2.5 shadow-xl [animation:pop-in_300ms_var(--ease-out)]"
                  >
                    <p class="min-h-9 text-xs text-highlighted">
                      <LandingTyped :text="COMMENT" :cps="32" :delay="250" />
                    </p>
                    <div class="mt-2 flex justify-end">
                      <span
                        data-cursor="send"
                        class="rounded-md bg-inverted px-2 py-0.5 text-[11px] font-medium text-inverted"
                        >Comment</span
                      >
                    </div>
                  </div>
                  <p
                    v-if="v2 && beat === 'b.v2'"
                    class="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-default bg-default px-3 py-2 text-xs text-highlighted shadow-lg [animation:pop-in_360ms_var(--ease-out)]"
                  >
                    <UIcon name="i-mingcute-check-circle-line" class="size-4" /> Claude Code published v2
                  </p>
                </article>

                <!-- The docked comments panel. -->
                <aside class="flex min-w-0 flex-col border-l border-default bg-muted/50">
                  <div class="flex h-10 shrink-0 items-center gap-2 border-b border-default px-3 text-xs">
                    <span class="font-medium text-highlighted">Comments</span>
                    <span class="font-mono text-[11px] text-dimmed tabular-nums">{{ posted && !v2 ? 1 : 0 }}</span>
                  </div>
                  <div class="space-y-2 p-2.5">
                    <p v-if="!posted" class="px-1 pt-1 text-xs text-dimmed">Select text to comment.</p>
                    <div
                      v-else
                      class="rounded-lg border border-default bg-default p-2.5 transition-opacity duration-500 [animation:pop-in_360ms_var(--ease-out)]"
                      :class="v2 && 'opacity-70'"
                    >
                      <div class="flex items-center gap-1.5">
                        <span
                          class="grid size-4 place-items-center rounded-full bg-inverted text-[9px] font-semibold text-inverted"
                          >1</span
                        >
                        <span class="text-xs font-medium text-highlighted">You</span>
                        <span class="ml-auto text-[10px] text-dimmed">now</span>
                      </div>
                      <p class="mt-1 text-xs text-toned">{{ COMMENT }}</p>
                      <p
                        v-if="v2"
                        class="mt-2 flex items-center gap-1 text-[10px] text-muted [animation:fade-in_400ms_ease-out]"
                      >
                        <UIcon name="i-mingcute-check-line" class="size-3" /> Resolved in v2 by Claude Code
                      </p>
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
