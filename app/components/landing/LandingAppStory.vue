<script setup lang="ts">
// Claude Code vibe-codes a tiny game and publishes it as an app drop; the link runs it.
// The game in the browser window is real, and the story stops looping once someone plays it.
import type { Beat } from "~/composables/useStoryboard"

const BEATS = [
  ["g.prompt", 2300],
  ["g.think", 1400],
  ["g.write", 1300],
  ["g.publish", 1900],
  ["g.play", 14000],
] as const satisfies readonly Beat[]

const FRAMES = {
  terminal: { x: 0, y: 36, w: 480, h: 404 },
  browser: { x: 370, y: 0, w: 630, h: 452 },
}

const stage = useTemplateRef<HTMLElement>("stage")
const { beat, at, held, playing, go } = useStoryboard(stage, BEATS, { still: "g.play" })
const live = computed(() => at("g.play"))

function play() {
  go("g.play")
  held.value = true
}
</script>

<template>
  <div ref="stage">
    <LandingStage :size="[1000, 452]" :compact-size="[630, 452]" :grow="1.06">
      <template #default>
        <LandingWindow
          title="claude — ~/play/catch"
          :frame="FRAMES.terminal"
          :state="live ? 'back' : 'front'"
          dark
          aria-hidden="true"
        >
          <template #icon><BrainlessClaudeLogo class="h-2.5" /></template>
          <div class="flex h-full flex-col gap-3 p-4">
            <div
              class="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden [&>*]:shrink-0 [&>*]:[animation:pop-in_320ms_var(--ease-out)]"
            >
              <BrainlessClaudeMessage v-if="at('g.think')" role="user"
                >make a tiny game where the hand catches falling files, then drop it</BrainlessClaudeMessage
              >
              <BrainlessClaudeThinking v-if="beat === 'g.think'" verb="Vibing" />
              <template v-if="at('g.write')">
                <BrainlessClaudeToolCall tool="Write" arg="catch/index.html" result="Wrote 41 lines" />
                <BrainlessClaudeToolCall tool="Write" arg="catch/game.js" result="Wrote 96 lines" />
              </template>
              <template v-if="at('g.publish')">
                <BrainlessClaudeToolCall
                  tool="drop - publish (MCP)"
                  arg='files: { "index.html", "game.js" }, lifetime: "temporary"'
                  result="Published: drop.vitehub.dev/d/c4tc (id=c4tc)"
                />
                <BrainlessClaudeMessage
                  >It's live. Switch sharing on and anyone with the link can play.</BrainlessClaudeMessage
                >
              </template>
            </div>
            <BrainlessClaudePrompt>
              <LandingTyped
                v-if="beat === 'g.prompt'"
                text="make a tiny game where the hand catches falling files, then drop it"
                :cps="34"
                :delay="300"
              />
            </BrainlessClaudePrompt>
          </div>
        </LandingWindow>

        <LandingWindow
          title="drop.vitehub.dev/d/c4tc"
          :frame="FRAMES.browser"
          :state="live ? 'front' : 'back'"
          :blank="!at('g.publish')"
          url
        >
          <div class="flex h-full flex-col">
            <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default px-4 text-sm" aria-hidden="true">
              <DropMark class="h-3.5 shrink-0" />
              <UIcon name="i-mingcute-folder-line" class="size-4 text-muted" />
              <span class="font-medium text-highlighted">catch/</span>
              <span class="rounded-md border border-default px-1.5 py-0.5 font-mono text-[11px] text-muted">v1</span>
              <span class="rounded-md bg-elevated px-1.5 py-0.5 text-[11px] text-muted">App</span>
              <span
                class="ml-auto flex items-center gap-1.5 rounded-md border border-default px-2 py-1 text-xs text-highlighted"
                ><UIcon name="i-mingcute-world-2-line" class="size-3.5" /> Share</span
              >
            </div>
            <LandingCatchGame class="min-h-0 flex-1" :running="live && playing" @play="play" />
          </div>
        </LandingWindow>
      </template>
    </LandingStage>
  </div>
</template>
