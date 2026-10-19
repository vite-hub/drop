<script setup lang="ts">
// Ana reviews a pull request's preview deploy where it runs: Drop's Comment button sits in the page's corner, she drags
// a box over the button and writes a note, and it lands in Drop with a screenshot. Claude Code reads it, fixes the
// page, and resolves it, and the preview shows the fix.
import type { Beat } from "~/composables/useStoryboard"

const BEATS = [
  ["s.open", 1700],
  ["s.press", 1200],
  ["s.drag", 1600],
  ["s.type", 2500],
  ["s.sent", 1900],
  ["a.prompt", 2100],
  ["a.read", 1700],
  ["a.fix", 1800],
  ["a.resolve", 1900],
  ["s.fixed", 3200],
] as const satisfies readonly Beat[]
type Name = (typeof BEATS)[number][0]

const FRAMES = {
  terminal: { x: 0, y: 30, w: 480, h: 440 },
  browser: { x: 340, y: 0, w: 660, h: 500 },
}

const NOTE = 'Say "Start free trial", like the launch email does.'

const stage = useTemplateRef<HTMLElement>("stage")
const canvas = useTemplateRef<HTMLElement>("canvas")
const { beat, index, at } = useStoryboard(stage, BEATS, { still: "s.fixed" })
const onTerminal = computed(() => at("a.prompt") && !at("s.fixed"))
const drawing = computed(() => at("s.press") && !at("s.sent"))
const fixed = computed(() => at("s.fixed"))

// Ana's pointer, and the beats that end in a click where it rests: the next beat shows what the click did.
const TARGETS: Partial<Record<Name, string>> = {
  "s.open": "comment",
  "s.press": "box-start",
  "s.drag": "box-end",
  "s.type": "send",
  "s.sent": "send",
  "s.fixed": "cta",
}
const CLICKS: Partial<Record<Name, true>> = { "s.open": true, "s.type": true }
const ana = useCursorTarget(canvas, () => TARGETS[beat.value])
const click = computed(() => (CLICKS[beat.value] ? BEATS[index.value]![1] - 380 : null))
</script>

<template>
  <div ref="stage" aria-hidden="true">
    <LandingStage :size="[1000, 500]" :compact-size="[660, 500]" :grow="1.06">
      <template #default>
        <div ref="canvas" class="absolute inset-0">
          <LandingWindow
            title="claude — ~/acme/web"
            :frame="FRAMES.terminal"
            :state="onTerminal ? 'front' : 'back'"
            dark
          >
            <template #icon><BrainlessClaudeLogo class="h-2.5" /></template>
            <div class="flex h-full flex-col gap-3 p-4">
              <div
                class="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden [&>*]:shrink-0 [&>*]:[animation:pop-in_320ms_var(--ease-out)]"
              >
                <BrainlessClaudeMessage v-if="at('a.read')" role="user"
                  >fix what the reviewers marked on the preview</BrainlessClaudeMessage
                >
                <BrainlessClaudeToolCall
                  v-if="at('a.read')"
                  tool="drop - read_drop (MCP)"
                  arg='id: "acme-previews"'
                  result='1. "Say "Start free trial"…" (Ana) · /pricing · screenshot'
                />
                <BrainlessClaudeDiff
                  v-if="at('a.fix')"
                  file="app/pages/pricing.vue"
                  summary="1 addition and 1 removal"
                  :lines="[
                    { type: 'del', n: 13, text: '<a class=&quot;cta&quot;>Get started</a>' },
                    { type: 'add', n: 13, text: '<a class=&quot;cta&quot;>Start free trial</a>' },
                  ]"
                />
                <template v-if="at('a.resolve')">
                  <BrainlessClaudeToolCall
                    tool="drop - update_drop (MCP)"
                    arg='id: "acme-previews", resolves: [1]'
                    result="Resolved #1"
                  />
                  <BrainlessClaudeMessage>Pushed. The preview redeploys with the new label.</BrainlessClaudeMessage>
                </template>
              </div>
              <BrainlessClaudePrompt>
                <LandingTyped
                  v-if="beat === 'a.prompt'"
                  text="fix what the reviewers marked on the preview"
                  :cps="34"
                  :delay="300"
                />
              </BrainlessClaudePrompt>
            </div>
          </LandingWindow>

          <LandingWindow
            title="pr-142.preview.acme.dev/pricing"
            :frame="FRAMES.browser"
            :state="onTerminal ? 'back' : 'front'"
            url
          >
            <div class="relative h-full overflow-hidden text-xs">
              <!-- The site under review: Acme's own page, not Drop. -->
              <div class="flex h-11 items-center gap-5 border-b border-default px-5">
                <span class="flex items-center gap-1.5 font-semibold text-highlighted"
                  ><span class="size-3.5 rounded-sm bg-inverted" />Acme</span
                >
                <span class="text-muted">Product</span><span class="font-medium text-highlighted">Pricing</span
                ><span class="text-muted">Docs</span>
                <span class="ml-auto text-muted">Sign in</span>
              </div>
              <div class="px-10 pt-10 text-center">
                <p class="label-mono text-[10px]">Pricing</p>
                <p class="mt-2 text-2xl font-semibold tracking-tight text-highlighted">Billing that grows with you</p>
                <p class="mx-auto mt-2 max-w-[44ch] text-muted">Pay for what your team uses. Change plans any time.</p>
                <div class="mt-5 flex justify-center gap-2">
                  <span data-cursor="cta" class="relative">
                    <span
                      :key="String(fixed)"
                      class="block rounded-md bg-inverted px-3.5 py-2 font-medium text-inverted"
                      :class="fixed && '[animation:flash_1.6s_var(--ease-out)]'"
                      >{{ fixed ? "Start free trial" : "Get started" }}</span
                    >
                    <span data-cursor="box-start" class="absolute -top-2 -left-2 size-1" />
                    <span data-cursor="box-end" class="absolute -right-2 -bottom-2 size-1" />
                    <span
                      v-if="at('s.press') && !at('s.sent')"
                      class="pointer-events-none absolute -inset-2 rounded border-2 border-(--ui-text-highlighted) bg-(--ui-text-highlighted)/10 transition-[clip-path] duration-1000 ease-(--ease-out)"
                      :class="at('s.drag') ? '[clip-path:inset(0)]' : '[clip-path:inset(0_100%_100%_0)]'"
                    />
                  </span>
                  <span class="rounded-md border border-default px-3.5 py-2 font-medium text-highlighted"
                    >Talk to sales</span
                  >
                </div>
              </div>
              <div class="mx-8 mt-9 grid grid-cols-3 gap-3">
                <div
                  v-for="plan in ['Starter', 'Team', 'Scale']"
                  :key="plan"
                  class="rounded-lg border border-default p-3"
                >
                  <p class="label-mono text-[10px]">{{ plan }}</p>
                  <div class="mt-2 h-2.5 w-16 rounded-full bg-accented" />
                  <div class="mt-2 h-2 w-24 rounded-full bg-elevated" />
                  <div class="mt-1.5 h-2 w-20 rounded-full bg-elevated" />
                </div>
              </div>

              <!-- Drop's review script: the corner bar, the drawing layer, the note, and the toast. -->
              <div v-if="drawing" class="absolute inset-0 bg-black/[.04] [animation:fade-in_250ms_ease-out]">
                <p
                  v-if="!at('s.type')"
                  class="absolute top-3 left-1/2 -translate-x-1/2 rounded-lg border border-default bg-default px-3 py-1.5 whitespace-nowrap text-highlighted shadow-md"
                >
                  Drag over what you want to comment on. Esc cancels.
                </p>
              </div>
              <div
                v-if="at('s.type') && !at('s.sent')"
                class="absolute top-[15.25rem] left-1/2 w-72 -translate-x-1/2 rounded-[10px] border border-default bg-default p-3 shadow-xl [animation:pop-in_300ms_var(--ease-out)]"
              >
                <p class="min-h-14 rounded-md border border-default px-2.5 py-2 text-highlighted">
                  <LandingTyped :text="NOTE" :cps="30" :delay="200" />
                </p>
                <div class="mt-2.5 flex items-center justify-end gap-2">
                  <span class="mr-auto text-[11px] text-muted">As Ana</span>
                  <span class="rounded-md border border-default px-2.5 py-1 font-medium text-highlighted">Cancel</span>
                  <span data-cursor="send" class="rounded-md bg-inverted px-2.5 py-1 font-medium text-inverted"
                    >Send</span
                  >
                </div>
              </div>
              <div
                v-if="at('s.sent') && !fixed"
                class="absolute right-4 bottom-16 flex items-center gap-2 rounded-lg border border-default bg-default px-3 py-2 shadow-md [animation:pop-in_300ms_var(--ease-out)]"
              >
                <span class="text-toned">Sent, with a screenshot.</span
                ><span class="font-medium text-highlighted underline underline-offset-2">Open in Drop</span>
              </div>
              <div
                class="absolute right-4 bottom-4 flex items-center gap-1 rounded-[10px] border border-default bg-default p-1 shadow-md"
              >
                <span
                  data-cursor="comment"
                  class="flex h-7 items-center gap-1.5 rounded-md bg-inverted px-2.5 font-medium text-inverted"
                  ><UIcon name="i-ph-chat-circle" class="size-3.5" />Comment</span
                >
                <span
                  v-if="at('s.sent') && !fixed"
                  class="grid h-6 min-w-6 place-items-center rounded-full bg-elevated px-1.5 font-mono text-[11px] text-highlighted [animation:pop-in_300ms_var(--ease-out)]"
                  >1</span
                >
              </div>
            </div>
          </LandingWindow>

          <LandingCursor
            :x="ana.x"
            :y="ana.y"
            :shown="ana.shown && !onTerminal"
            label="Ana"
            :click="click"
            :beat="beat"
          />
        </div>
      </template>
    </LandingStage>
  </div>
</template>
