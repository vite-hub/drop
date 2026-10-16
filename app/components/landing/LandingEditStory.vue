<script setup lang="ts">
// Editing a Markdown drop together, the Notion way: "/" turns a line into a heading, "@" names a teammate, ":" picks
// an emoji, the bubble toolbar bolds a phrase, Ben's caret answers live, and Publish makes the next version.
// Every menu here mirrors the real editor (ViewerEditor.vue); the stage is decorative.
import type { Beat } from "~/composables/useStoryboard"

const BEATS = [
  ["t.idle", 1300], ["t.slash", 1800], ["t.heading", 1500],
  ["t.at", 900], ["t.at2", 1000], ["t.write", 2400], ["t.colon", 1400], ["t.emoji", 700],
  ["t.select", 1100], ["t.bold", 1300], ["t.ben", 2500], ["t.publish", 1300], ["t.done", 2800],
] as const satisfies readonly Beat[]
type Name = (typeof BEATS)[number][0]

const BEN = "#2563eb"
const ANA = "#ea580c"

const BLOCKS = [
  { label: "Heading 1", icon: "i-lucide-heading-1" },
  { label: "Heading 2", icon: "i-lucide-heading-2" },
  { label: "Heading 3", icon: "i-lucide-heading-3" },
]
const PEOPLE = [
  { name: "Ana", color: ANA },
  { name: "Ben", color: BEN },
  { name: "Lea", color: "#7c3aed" },
]
const EMOJIS = [
  { emoji: "🙏", name: "pray" },
  { emoji: "🙌", name: "raised_hands" },
  { emoji: "🤲", name: "palms_up_together" },
]
const TOOLBAR = [["i-lucide-bold", "i-lucide-italic", "i-lucide-strikethrough", "i-lucide-code", "i-lucide-link"], ["i-lucide-heading-1", "i-lucide-heading-2", "i-lucide-heading-3"], ["i-lucide-list", "i-lucide-list-ordered", "i-lucide-text-quote"]]

const stage = useTemplateRef<HTMLElement>("stage")
const canvas = useTemplateRef<HTMLElement>("canvas")
const { beat, index, at } = useStoryboard(stage, BEATS, { still: "t.done" })

// Your pointer only comes out for the clicks: Bold in the toolbar, then Publish.
const TARGETS: Partial<Record<Name, string>> = { "t.select": "bold-button", "t.bold": "bold-button", "t.publish": "publish", "t.done": "publish" }
const you = useCursorTarget(canvas, () => TARGETS[beat.value])
const click = computed(() => (beat.value === "t.select" || beat.value === "t.publish" ? BEATS[index.value]![1] - 380 : null))
const bold = computed(() => at("t.bold"))
const caretAtLine = computed(() => (!at("t.heading") ? "new" : !at("t.at") ? "heading" : !at("t.select") ? "line" : null))
</script>

<template>
  <div ref="stage" aria-hidden="true">
    <LandingStage :size="[780, 560]" :compact-size="[780, 560]" :grow="1.32">
      <template #default>
        <div ref="canvas" class="absolute inset-0">
          <LandingWindow title="drop.vitehub.dev/d/m8r2" :frame="{ x: 0, y: 0, w: 780, h: 560 }" state="front" url>
            <div class="relative flex h-full flex-col">
              <!-- The viewer in edit mode -->
              <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default px-4 text-sm">
                <DropMark class="h-3.5 shrink-0" />
                <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
                <span class="font-medium text-highlighted">launch-plan.md</span>
                <span :key="String(at('t.done'))" class="rounded-md border border-default px-1.5 py-0.5 font-mono text-[11px] text-muted [animation:pop-in_400ms_var(--ease-out)]">{{ at("t.done") ? "v3" : "v2" }}</span>
                <span v-if="!at('t.done')" class="flex items-center gap-1.5 text-xs text-muted"><span class="size-1.5 rounded-full bg-(--ui-text-muted)" />Editing live</span>
                <div class="ml-auto flex items-center gap-3">
                  <div class="flex -space-x-1.5">
                    <span v-for="person in PEOPLE.slice(0, 2)" :key="person.name" class="grid size-6 place-items-center rounded-full bg-elevated text-[10px] font-semibold text-highlighted ring-2" :style="{ '--tw-ring-color': person.color }">{{ person.name[0] }}</span>
                    <span class="grid size-6 place-items-center rounded-full bg-inverted text-[10px] font-semibold text-inverted ring-2 ring-(--ui-bg)">Y</span>
                  </div>
                  <span data-cursor="publish" class="rounded-md bg-inverted px-2.5 py-1 text-xs font-medium text-inverted">Publish</span>
                </div>
              </div>

              <!-- The page: the reader's column and typeset -->
              <div class="min-h-0 flex-1 overflow-hidden">
                <div class="mx-auto max-w-[34rem] px-6 pt-6 text-[14px] leading-relaxed text-toned">
                  <p class="text-[34px] leading-none">🚀</p>
                  <h3 class="mt-3 text-[26px] leading-tight font-semibold tracking-tight text-highlighted">Launch plan</h3>
                  <p class="mt-3">We ship on Oct 24, with the email that morning.</p>
                  <h4 class="mt-5 text-[17px] font-semibold text-highlighted">Scope</h4>
                  <ul class="mt-1 list-disc pl-5">
                    <li>Pricing page with seat plans</li>
                    <li class="relative">Changelog post and launch email<LandingLiveCaret v-if="!at('t.ben')" name="Ben" :color="BEN" /></li>
                  </ul>

                  <!-- Line 1: "/" turns an empty line into a heading. -->
                  <div class="relative mt-5 min-h-7">
                    <h4 v-if="at('t.heading')" class="text-[17px] font-semibold text-highlighted">
                      <LandingTyped v-if="beat === 't.heading'" text="Risks" :cps="12" :delay="250" /><template v-else>Risks</template><LandingEditCaret v-if="caretAtLine === 'heading'" />
                    </h4>
                    <p v-else>
                      <template v-if="beat === 't.slash'"><LandingTyped text="/hea" :cps="9" :delay="150" /></template>
                      <span v-else class="text-dimmed">Write, or type / for blocks, : for emoji, @ for people</span>
                      <LandingEditCaret v-if="caretAtLine === 'new'" />
                    </p>
                    <LandingEditMenu v-if="beat === 't.slash'" label="Blocks" class="top-7 left-0">
                      <div v-for="(block, position) in BLOCKS" :key="block.label" class="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors delay-700" :class="position === 1 && 'bg-elevated text-highlighted'">
                        <span class="grid size-6 place-items-center rounded-md border border-default bg-default"><UIcon :name="block.icon" class="size-3.5" /></span>{{ block.label }}
                      </div>
                    </LandingEditMenu>
                  </div>

                  <!-- Line 2: "@" names Ben, ":" adds an emoji, the toolbar bolds a phrase. -->
                  <div v-if="at('t.at')" class="relative mt-2 min-h-7">
                    <p>
                      <template v-if="!at('t.write')"><LandingTyped :text="beat === 't.at' ? '@' : '@be'" :cps="beat === 't.at' ? 20 : 8" /></template>
                      <template v-else>
                        <span class="rounded bg-elevated px-1 font-medium text-highlighted">@Ben</span>
                        <LandingTyped v-if="beat === 't.write'" text=" can you do the docs pass before the email? " :cps="22" :delay="150" />
                        <template v-else>
                          can you do the
                          <span class="relative rounded-sm transition-colors" :class="[at('t.select') && !bold && 'bg-[#2563eb]/15', bold && 'font-semibold text-highlighted']">docs pass</span>
                          before the email?
                          <template v-if="beat === 't.colon'"><LandingTyped text=":pray" :cps="10" /></template>
                          <span v-else-if="at('t.emoji')" class="[animation:pop-in_300ms_var(--ease-out)]">🙏</span>
                        </template>
                      </template>
                      <LandingEditCaret v-if="caretAtLine === 'line'" />
                    </p>
                    <LandingEditMenu v-if="beat === 't.at' || beat === 't.at2'" label="People" class="top-7 left-0">
                      <div v-for="person in beat === 't.at' ? PEOPLE : PEOPLE.filter(item => item.name === 'Ben')" :key="person.name" class="flex items-center gap-2 rounded-md px-2 py-1.5" :class="person.name === 'Ben' && beat === 't.at2' && 'bg-elevated text-highlighted'">
                        <span class="grid size-5 place-items-center rounded-full text-[9px] font-semibold text-white" :style="{ background: person.color }">{{ person.name[0] }}</span>{{ person.name }}
                      </div>
                    </LandingEditMenu>
                    <LandingEditMenu v-if="beat === 't.colon'" label="Emoji" class="top-7 left-[17rem]">
                      <div v-for="(item, position) in EMOJIS" :key="item.name" class="flex items-center gap-2 rounded-md px-2 py-1.5" :class="position === 0 && 'bg-elevated text-highlighted'">
                        <span class="w-5 text-center text-base">{{ item.emoji }}</span>{{ item.name }}
                      </div>
                    </LandingEditMenu>
                    <!-- Nuxt UI's bubble toolbar, as the editor configures it -->
                    <div v-if="at('t.select') && !at('t.ben')" class="absolute -top-11 left-24 z-10 flex items-center gap-0.5 rounded-lg border border-default bg-default p-0.5 shadow-[0_4px_16px_rgb(0_0_0/0.08)] [animation:pop-in_160ms_var(--ease-out)]">
                      <template v-for="(group, groupIndex) in TOOLBAR" :key="groupIndex">
                        <span v-if="groupIndex" class="mx-0.5 h-4 w-px bg-(--ui-border)" />
                        <span v-for="icon in group" :key="icon" :data-cursor="icon === 'i-lucide-bold' ? 'bold-button' : undefined" class="grid size-7 place-items-center rounded-md" :class="icon === 'i-lucide-bold' && bold ? 'bg-elevated text-highlighted' : 'text-muted'">
                          <UIcon :name="icon" class="size-3.5" />
                        </span>
                      </template>
                    </div>
                  </div>

                  <!-- Line 3: Ben answers, live. -->
                  <p v-if="at('t.ben')" class="relative mt-2">
                    <LandingTyped v-if="beat === 't.ben'" text="On it, done by Thursday ✅" :cps="16" :delay="300" /><template v-else>On it, done by Thursday ✅</template><LandingLiveCaret name="Ben" :color="BEN" />
                  </p>
                </div>
              </div>

              <!-- The toast Publish shows (useLiveEditor) -->
              <div v-if="at('t.done')" class="absolute right-4 bottom-4 z-20 w-64 rounded-lg border border-default bg-default p-3 shadow-lg [animation:pop-in_300ms_var(--ease-out)]">
                <p class="flex items-center gap-2 text-sm font-medium text-highlighted"><UIcon name="i-lucide-check" class="size-4" />Published v3</p>
                <p class="mt-0.5 pl-6 text-xs text-muted">The previous version stays in history.</p>
              </div>
            </div>
          </LandingWindow>

          <LandingCursor :x="you.x" :y="you.y" :shown="you.shown" label="You" :click="click" :beat="beat" />
        </div>
      </template>
    </LandingStage>
  </div>
</template>
