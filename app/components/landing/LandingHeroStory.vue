<script setup lang="ts">
// The hero: one Markdown drop going around the loop. Claude Code drops it, you comment in the browser,
// Claude Code addresses the comment, you switch sharing on and post the link, and the team joins in.
// Your pointer switches apps from the dock, so every hop between tools is visible.
// The stage is decorative; the chapter buttons under it tell the same story and jump to each part.
import type { Beat } from "~/composables/useStoryboard"

const BEATS = [
  ["a.prompt", 2300],
  ["a.think", 1500],
  ["a.drop", 2200],
  ["a.dock", 1500],
  ["b.open", 1300],
  ["b.select", 1400],
  ["b.type", 2100],
  ["b.press", 1200],
  ["b.post", 1300],
  ["b.dock", 1500],
  ["c.prompt", 2000],
  ["c.read", 1500],
  ["c.diff", 2000],
  ["c.drop", 1700],
  ["c.dock", 1500],
  ["d.open", 1500],
  ["d.share", 1300],
  ["d.modal", 1300],
  ["d.switch", 1100],
  ["d.copy", 1300],
  ["d.dock", 1600],
  ["e.open", 1900],
  ["e.post", 1500],
  ["e.replies", 2200],
  ["e.dock", 1500],
  ["f.join", 1500],
  ["f.comments", 2800],
  ["f.hold", 2200],
] as const satisfies readonly Beat[]
type Name = (typeof BEATS)[number][0]

const CHAPTERS: { label: string; from: Name; to: Name }[] = [
  { label: "Claude Code drops a doc", from: "a.prompt", to: "a.dock" },
  { label: "You comment on a line", from: "b.open", to: "b.dock" },
  { label: "Claude Code drops v2", from: "c.prompt", to: "c.dock" },
  { label: "You switch sharing on", from: "d.open", to: "d.dock" },
  { label: "You post the link in Slack", from: "e.open", to: "e.dock" },
  { label: "The team comments", from: "f.join", to: "f.hold" },
]

const TEAM = [
  { n: 2, name: "Ben", target: "changelog", body: "I'll write the changelog." },
  { n: 3, name: "Lea", target: "risks", body: "Docs pass is done." },
  { n: 4, name: "Ana", target: "migration", body: "Link the Teams FAQ here." },
]

const APPS = [
  { id: "terminal", label: "Claude Code" },
  { id: "browser", label: "Browser" },
  { id: "chat", label: "Slack" },
] as const

const FRAMES = {
  terminal: { x: 0, y: 64, w: 540, h: 420 },
  browser: { x: 330, y: 0, w: 670, h: 492 },
  chat: { x: 70, y: 84, w: 520, h: 400 },
}

const stage = useTemplateRef<HTMLElement>("stage")
const canvas = useTemplateRef<HTMLElement>("canvas")
const { beat, index, at, go, indexOf, playing, reduced } = useStoryboard(stage, BEATS, { still: "f.hold" })

const SCENES = ["a", "b", "c", "d", "e", "f"] as const
// Every beat's name starts with its scene's letter.
const scene = computed(() => SCENES.find((letter) => beat.value.startsWith(`${letter}.`)) ?? "a")
const windows = computed(
  () =>
    ({
      terminal: "ac".includes(scene.value) ? "front" : "back",
      browser: "bdf".includes(scene.value) ? "front" : "back",
      chat: scene.value === "e" ? "front" : "hidden",
    }) as const,
)

const v2 = computed(() => at("d.open"))
const modal = computed(() => at("d.modal") && !at("d.dock"))
const shared = computed(() => at("d.switch"))
const copied = computed(() => at("d.dock"))
const front = computed(() => APPS.find((app) => windows.value[app.id] === "front")?.id)

// Apps that have been opened this loop get a dot under their dock icon, like a running app.
const running = computed(() => ({ terminal: true, browser: at("b.open"), chat: at("e.open") }))

// Your pointer: where it heads in each beat, and the beats that end in a click there.
const TARGETS: Partial<Record<Name, string>> = {
  "a.dock": "dock-browser",
  "b.open": "title",
  "b.select": "sentence",
  "b.type": "sentence",
  "b.press": "post",
  "b.post": "post",
  "b.dock": "dock-terminal",
  "c.prompt": "dock-terminal",
  "c.read": "dock-terminal",
  "c.diff": "dock-terminal",
  "c.drop": "dock-terminal",
  "c.dock": "dock-browser",
  "d.open": "sentence",
  "d.share": "share",
  "d.modal": "switch",
  "d.switch": "switch",
  "d.copy": "copy",
  "d.dock": "dock-chat",
  "e.open": "composer",
  "e.post": "composer",
  "e.replies": "composer",
  "e.dock": "dock-browser",
}
const CLICKS: Partial<Record<Name, true>> = {
  "a.dock": true,
  "b.press": true,
  "b.dock": true,
  "c.dock": true,
  "d.share": true,
  "d.modal": true,
  "d.copy": true,
  "d.dock": true,
  "e.dock": true,
}
const you = useCursorTarget(canvas, () => TARGETS[beat.value])
const click = computed(() => (CLICKS[beat.value] ? BEATS[index.value]![1] - 380 : null))
// The app the pointer is about to open shows its name over the dock.
const hovered = computed(() => (beat.value.endsWith(".dock") ? TARGETS[beat.value]!.replace("dock-", "") : null))
const teamCursors = TEAM.map((member) =>
  reactive({
    ...member,
    at: useCursorTarget(canvas, () => (scene.value === "f" ? member.target : null), { x: 0.3, y: 1.2 }),
  }),
)

const chapter = computed(() => CHAPTERS.findLastIndex((item) => index.value >= indexOf(item.from)))
const chapterMs = (item: (typeof CHAPTERS)[number]) =>
  BEATS.slice(indexOf(item.from), indexOf(item.to) + 1).reduce((sum, [, ms]) => sum + ms, 0)
// Restarts the progress bar even when the same chapter is picked again.
const jumps = ref(0)
function pick(item: (typeof CHAPTERS)[number]) {
  jumps.value++
  go(reduced.value ? item.to : item.from)
}
</script>

<template>
  <div>
    <div ref="stage" aria-hidden="true">
      <LandingStage :size="[1000, 566]" :compact-size="[670, 566]" :grow="1.1">
        <template #default>
          <div ref="canvas" class="absolute inset-0">
            <!-- Claude Code -->
            <LandingWindow title="claude — ~/acme/launch" :frame="FRAMES.terminal" :state="windows.terminal" dark>
              <template #icon><BrainlessClaudeLogo class="h-2.5" /></template>
              <div class="flex h-full flex-col gap-3 p-4">
                <div
                  class="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden [&>*]:shrink-0 [&>*]:[animation:pop-in_320ms_var(--ease-out)]"
                >
                  <template v-if="at('a.think')">
                    <BrainlessClaudeMessage role="user"
                      >write the launch plan and drop it for review</BrainlessClaudeMessage
                    >
                  </template>
                  <BrainlessClaudeThinking v-if="beat === 'a.think'" verb="Drafting" />
                  <template v-if="at('a.drop')">
                    <BrainlessClaudeMessage>Drafted it from the roadmap notes.</BrainlessClaudeMessage>
                    <BrainlessClaudeToolCall
                      tool="drop - publish (MCP)"
                      arg='markdown: "# Launch plan…", lifetime: "review", note: "First draft"'
                      result="Published: drop.vitehub.dev/d/k3x9 (id=k3x9)"
                    />
                    <BrainlessClaudeMessage>Ready for review: drop.vitehub.dev/d/k3x9</BrainlessClaudeMessage>
                  </template>
                  <template v-if="at('c.read')">
                    <BrainlessClaudeMessage role="user">address the comments on the launch plan</BrainlessClaudeMessage>
                    <BrainlessClaudeToolCall
                      tool="drop - read_drop (MCP)"
                      arg='id: "k3x9"'
                      result="1. > We ship on Oct 17, … Legal needs a week. Make it Oct 24. (You)"
                    />
                  </template>
                  <BrainlessClaudeDiff
                    v-if="at('c.diff')"
                    file="launch-plan.md"
                    summary="Moved the ship date"
                    :lines="[
                      { type: 'ctx', n: 3, text: '## When' },
                      { type: 'del', n: 4, text: 'We ship on Oct 17, with the email that morning.' },
                      { type: 'add', n: 4, text: 'We ship on Oct 24, with the email that morning.' },
                    ]"
                  />
                  <BrainlessClaudeToolCall
                    v-if="at('c.drop')"
                    tool="drop - publish (MCP)"
                    arg='previous: "k3x9", resolves: [1], note: "Ship on Oct 24", …'
                    result="Published v2, resolved #1: drop.vitehub.dev/d/m8r2 (id=m8r2)"
                  />
                </div>
                <BrainlessClaudePrompt>
                  <LandingTyped
                    v-if="beat === 'a.prompt'"
                    text="write the launch plan and drop it for review"
                    :delay="300"
                  />
                  <LandingTyped
                    v-else-if="beat === 'c.prompt'"
                    text="address the comments on the launch plan"
                    :delay="300"
                  />
                </BrainlessClaudePrompt>
              </div>
            </LandingWindow>

            <!-- The drop in the browser -->
            <LandingWindow
              :title="`drop.vitehub.dev/d/${v2 ? 'm8r2' : 'k3x9'}`"
              :frame="FRAMES.browser"
              :state="windows.browser"
              :blank="!at('a.drop')"
              url
            >
              <div class="relative flex h-full flex-col">
                <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default px-4 text-sm">
                  <DropMark class="h-3.5 shrink-0" />
                  <UIcon name="i-mingcute-document-2-line" class="size-4 text-muted" />
                  <span class="font-medium text-highlighted">launch-plan.md</span>
                  <span
                    :key="String(v2)"
                    class="rounded-md border border-default px-1.5 py-0.5 font-mono text-[11px] text-muted [animation:pop-in_400ms_var(--ease-out)]"
                    >{{ v2 ? "v2" : "v1" }}</span
                  >
                  <div class="ml-auto flex items-center gap-3">
                    <div class="flex -space-x-1.5">
                      <span
                        v-for="member in at('f.join') ? TEAM : []"
                        :key="member.name"
                        class="grid size-6 place-items-center rounded-full bg-elevated text-[10px] font-semibold text-highlighted ring-2 ring-(--ui-bg) [animation:pop-in_400ms_var(--ease-out)_both]"
                        :style="{ animationDelay: `${member.n * 120}ms` }"
                        >{{ member.name[0] }}</span
                      >
                      <span
                        class="grid size-6 place-items-center rounded-full bg-inverted text-[10px] font-semibold text-inverted ring-2 ring-(--ui-bg)"
                        >Y</span
                      >
                    </div>
                    <span
                      data-cursor="share"
                      class="flex items-center gap-1.5 rounded-md border border-default px-2 py-1 text-xs text-highlighted"
                    >
                      <UIcon :name="shared ? 'i-mingcute-world-2-line' : 'i-mingcute-lock-line'" class="size-3.5" />
                      Share
                    </span>
                  </div>
                </div>

                <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_13.5rem]">
                  <article class="min-w-0 px-7 py-6 text-[13px] leading-relaxed text-toned">
                    <h3 data-cursor="title" class="text-xl font-semibold tracking-tight text-highlighted">
                      Launch plan
                    </h3>
                    <p class="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                      <AgentIcon name="Claude Code" kind="agent" class="size-3" /> Claude Code ·
                      {{ v2 ? "v2 · 1 comment addressed" : "v1" }}
                    </p>
                    <h4 class="mt-5 text-sm font-semibold text-highlighted">When</h4>
                    <div class="relative mt-1">
                      <span
                        data-cursor="sentence"
                        class="relative rounded-sm transition-colors delay-500 duration-300"
                        :class="at('b.select') && !v2 && 'bg-accented text-highlighted'"
                      >
                        We ship on
                        <span
                          :key="String(v2)"
                          class="rounded-sm"
                          :class="v2 && 'font-medium text-highlighted [animation:flash_1.6s_var(--ease-out)]'"
                          >{{ v2 ? "Oct 24" : "Oct 17" }}</span
                        >, with the email that morning.
                        <span
                          v-if="at('b.post') && !v2"
                          class="absolute -top-3 -right-4 grid size-5 place-items-center rounded-full bg-inverted text-[10px] font-semibold text-inverted ring-2 ring-(--ui-bg) [animation:pop-in_300ms_var(--ease-out)]"
                          >1</span
                        >
                      </span>
                      <div
                        v-if="at('b.type') && !at('b.post')"
                        class="absolute top-full left-10 z-10 mt-2 w-64 rounded-lg border border-default bg-default p-3 shadow-lg [animation:pop-in_300ms_var(--ease-out)]"
                      >
                        <div class="flex items-start gap-2">
                          <span
                            class="grid size-5 shrink-0 place-items-center rounded-full bg-inverted text-[9px] font-semibold text-inverted"
                            >Y</span
                          >
                          <p class="min-h-9 text-xs text-highlighted">
                            <LandingTyped text="Legal needs a week. Make it Oct 24." :cps="26" :delay="200" />
                          </p>
                        </div>
                        <div class="mt-2 flex justify-end">
                          <span
                            data-cursor="post"
                            class="rounded-md bg-inverted px-2.5 py-1 text-[11px] font-medium text-inverted"
                            >Comment</span
                          >
                        </div>
                      </div>
                    </div>
                    <h4 class="mt-5 text-sm font-semibold text-highlighted">Scope</h4>
                    <ul class="mt-1 list-disc space-y-0.5 pl-5">
                      <li>Pricing page with seat plans</li>
                      <li>
                        <span
                          data-cursor="changelog"
                          class="relative rounded-sm"
                          :class="at('f.comments') && 'bg-accented'"
                          >Changelog post and launch email<LandingStoryPin v-if="at('f.comments')" :n="2" :delay="0"
                        /></span>
                      </li>
                      <li>
                        <span
                          data-cursor="migration"
                          class="relative rounded-sm"
                          :class="at('f.comments') && 'bg-accented'"
                          >Migration guide for teams<LandingStoryPin v-if="at('f.comments')" :n="4" :delay="1400"
                        /></span>
                      </li>
                    </ul>
                    <h4 class="mt-5 text-sm font-semibold text-highlighted">Risks</h4>
                    <ul class="mt-1 list-disc pl-5">
                      <li>
                        <span data-cursor="risks" class="relative rounded-sm" :class="at('f.comments') && 'bg-accented'"
                          >Docs need a pass before the email.<LandingStoryPin
                            v-if="at('f.comments')"
                            :n="3"
                            :delay="700"
                        /></span>
                      </li>
                    </ul>
                  </article>

                  <aside class="flex min-w-0 flex-col border-l border-default bg-muted/50">
                    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-default px-3 text-xs">
                      <span class="font-medium text-highlighted">Comments</span>
                      <span class="font-mono text-[11px] text-dimmed tabular-nums">{{
                        at("f.comments") ? 4 : at("b.post") ? 1 : 0
                      }}</span>
                    </div>
                    <div class="space-y-2 p-2.5">
                      <p v-if="!at('b.post')" class="px-1 py-6 text-center text-xs text-dimmed">
                        Select text to comment.
                      </p>
                      <div
                        v-else
                        class="rounded-lg border border-default bg-default p-2.5 [animation:pop-in_360ms_var(--ease-out)]"
                      >
                        <div class="flex items-center gap-1.5">
                          <span
                            class="grid size-4 place-items-center rounded-full bg-inverted text-[9px] font-semibold text-inverted"
                            >1</span
                          >
                          <span class="text-xs font-medium text-highlighted">You</span>
                          <span
                            v-if="v2"
                            class="ml-auto rounded-full bg-elevated px-1.5 py-0.5 text-[10px] text-muted [animation:pop-in_360ms_var(--ease-out)]"
                            >Addressed in v2</span
                          >
                        </div>
                        <p class="mt-1 text-xs text-toned" :class="v2 && 'text-muted'">
                          Legal needs a week. Make it Oct 24.
                        </p>
                      </div>
                      <template v-if="at('f.comments')">
                        <div
                          v-for="(member, position) in TEAM"
                          :key="member.n"
                          class="rounded-lg border border-default bg-default p-2.5 [animation:pop-in_360ms_var(--ease-out)_both]"
                          :style="{ animationDelay: `${position * 700}ms` }"
                        >
                          <div class="flex items-center gap-1.5">
                            <span
                              class="grid size-4 place-items-center rounded-full bg-inverted text-[9px] font-semibold text-inverted"
                              >{{ member.n }}</span
                            >
                            <span class="text-xs font-medium text-highlighted">{{ member.name }}</span>
                          </div>
                          <p class="mt-1 text-xs text-toned">{{ member.body }}</p>
                        </div>
                      </template>
                    </div>
                  </aside>
                </div>

                <!-- Share dialog -->
                <div
                  v-if="modal"
                  class="absolute inset-0 z-30 grid place-items-center bg-black/25 [animation:fade-in_250ms_ease-out]"
                >
                  <div
                    class="w-80 rounded-xl border border-default bg-default p-4 shadow-xl [animation:pop-in_300ms_var(--ease-out)]"
                  >
                    <p class="text-sm font-semibold text-highlighted">Share drop</p>
                    <p class="text-xs text-muted">Launch plan</p>
                    <div class="mt-3 divide-y divide-default rounded-lg border border-default">
                      <div class="flex items-center gap-3 p-3">
                        <span class="grid size-8 place-items-center rounded-md bg-elevated text-muted"
                          ><UIcon :name="shared ? 'i-mingcute-world-2-line' : 'i-mingcute-lock-line'" class="size-4"
                        /></span>
                        <div class="min-w-0 flex-1">
                          <p class="text-sm font-medium text-highlighted">
                            {{ shared ? "Anyone with the link" : "Only you" }}
                          </p>
                          <p class="text-xs text-muted">
                            {{ shared ? "No sign-in needed." : "Your connected agents can still read it." }}
                          </p>
                        </div>
                        <span
                          data-cursor="switch"
                          class="relative h-5 w-9 shrink-0 rounded-full transition-colors duration-300"
                          :class="shared ? 'bg-inverted' : 'bg-accented'"
                        >
                          <span
                            class="absolute top-0.5 left-0.5 size-4 rounded-full bg-default shadow-sm transition-transform duration-300 ease-(--ease-out)"
                            :class="shared && 'translate-x-4'"
                          />
                        </span>
                      </div>
                      <div
                        class="grid transition-[grid-template-rows] duration-500 ease-(--ease-out)"
                        :class="shared ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
                      >
                        <div class="min-h-0 overflow-hidden">
                          <div class="space-y-1.5 p-3">
                            <div
                              v-for="level in ['Can view', 'Can comment', 'Can edit']"
                              :key="level"
                              class="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                              :class="
                                level === 'Can comment'
                                  ? 'border-(--ui-border-accented) text-highlighted'
                                  : 'border-default text-muted'
                              "
                            >
                              <span
                                class="grid size-3.5 place-items-center rounded-full border border-(--ui-border-accented)"
                                ><span v-if="level === 'Can comment'" class="size-1.5 rounded-full bg-inverted" /></span
                              >{{ level }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div
                      class="mt-3 flex items-center gap-1 rounded-md border border-default bg-muted py-1 pr-1 pl-3 transition-opacity"
                      :class="!shared && 'opacity-50'"
                    >
                      <span class="min-w-0 flex-1 truncate font-mono text-xs">drop.vitehub.dev/d/m8r2</span>
                      <span data-cursor="copy" class="grid size-6 place-items-center rounded text-highlighted"
                        ><UIcon :name="copied ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'" class="size-3.5"
                      /></span>
                    </div>
                  </div>
                </div>
              </div>
            </LandingWindow>

            <!-- Team chat -->
            <LandingWindow title="Slack · Acme" :frame="FRAMES.chat" :state="windows.chat">
              <template #icon><UIcon name="i-simple-icons-slack" class="size-3" /></template>
              <div class="grid h-full grid-cols-[8.5rem_minmax(0,1fr)] text-xs">
                <div class="border-r border-default bg-muted p-3">
                  <p class="font-semibold text-highlighted">Acme</p>
                  <p class="label-mono mt-4 mb-1.5 text-[10px]">Channels</p>
                  <p
                    v-for="channel in ['general', 'launch', 'design']"
                    :key="channel"
                    class="rounded px-1.5 py-1"
                    :class="channel === 'launch' ? 'bg-accented font-medium text-highlighted' : 'text-muted'"
                  >
                    # {{ channel }}
                  </p>
                  <p class="label-mono mt-4 mb-1.5 text-[10px]">People</p>
                  <p v-for="member in TEAM" :key="member.name" class="flex items-center gap-1.5 px-1.5 py-1 text-muted">
                    <span class="size-1.5 rounded-full bg-inverted/60" />{{ member.name }}
                  </p>
                </div>
                <div class="flex min-w-0 flex-col">
                  <div
                    class="flex h-10 shrink-0 items-center border-b border-default px-4 font-medium text-highlighted"
                  >
                    # launch
                  </div>
                  <div class="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden p-4">
                    <LandingChatMessage name="Ben" time="10:02"
                      >Is the launch plan ready for a look?</LandingChatMessage
                    >
                    <LandingChatMessage
                      v-if="at('e.post')"
                      name="You"
                      time="10:14"
                      class="[animation:pop-in_360ms_var(--ease-out)]"
                    >
                      Here it is, comments are open.
                      <div
                        class="mt-1.5 flex items-center gap-3 rounded-md border-l-2 border-(--ui-border-accented) bg-muted py-2 pr-3 pl-3"
                      >
                        <DropMark class="h-4 shrink-0" />
                        <div class="min-w-0">
                          <p class="font-medium text-highlighted">Launch plan · Drop</p>
                          <p class="truncate text-muted">Anyone with the link can comment</p>
                        </div>
                      </div>
                      <span
                        v-if="at('e.replies')"
                        class="mt-1.5 inline-flex rounded-full border border-default px-1.5 py-0.5 text-[10px] [animation:pop-in_300ms_var(--ease-out)_1.4s_both]"
                        >👀 3</span
                      >
                    </LandingChatMessage>
                    <template v-if="at('e.replies')">
                      <LandingChatMessage name="Ana" time="10:15" class="[animation:pop-in_360ms_var(--ease-out)_both]"
                        >Reading it now</LandingChatMessage
                      >
                      <LandingChatMessage
                        name="Lea"
                        time="10:15"
                        class="[animation:pop-in_360ms_var(--ease-out)_800ms_both]"
                        >Adding notes on the risks</LandingChatMessage
                      >
                    </template>
                  </div>
                  <div data-cursor="composer" class="m-3 mt-0 rounded-lg border border-default px-3 py-2 text-muted">
                    <LandingTyped
                      v-if="beat === 'e.open'"
                      class="text-highlighted"
                      text="Here it is, comments are open. drop.vitehub.dev/d/m8r2"
                      :cps="36"
                      :delay="400"
                    />
                    <span v-else>Message #launch</span>
                  </div>
                </div>
              </div>
            </LandingWindow>

            <!-- The dock: how you move between apps. -->
            <div
              class="absolute bottom-1 left-1/2 z-40 flex -translate-x-1/2 items-end gap-2 rounded-2xl border border-default bg-default/85 p-2 shadow-xl shadow-black/10 backdrop-blur dark:shadow-black/50"
            >
              <div
                v-for="app in APPS"
                :key="app.id"
                :data-cursor="`dock-${app.id}`"
                class="relative flex flex-col items-center"
              >
                <span
                  class="absolute -top-9 rounded-md bg-inverted px-2 py-1 text-[11px] font-medium whitespace-nowrap text-inverted shadow-md transition-[opacity,transform] duration-300"
                  :class="hovered === app.id ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'"
                  >{{ app.label }}</span
                >
                <span
                  :key="front === app.id ? `open-${scene}` : 'idle'"
                  class="grid size-11 place-items-center rounded-xl border shadow-sm"
                  :class="[
                    app.id === 'terminal' ? 'border-white/10 bg-[#0f0f10]' : 'border-default bg-elevated',
                    front === app.id && '[animation:dock-bounce_700ms_var(--ease-out)]',
                  ]"
                >
                  <BrainlessClaudeLogo v-if="app.id === 'terminal'" class="h-3.5" />
                  <UIcon
                    v-else-if="app.id === 'browser'"
                    name="i-mingcute-compass-line"
                    class="size-5 text-highlighted"
                  />
                  <UIcon v-else name="i-simple-icons-slack" class="size-5 text-highlighted" />
                </span>
                <span
                  class="mt-1 size-1 rounded-full transition-colors"
                  :class="running[app.id] ? 'bg-(--ui-text-muted)' : 'bg-transparent'"
                />
              </div>
            </div>

            <LandingCursor :x="you.x" :y="you.y" :shown="you.shown" label="You" :click="click" :beat="beat" />
            <LandingCursor
              v-for="member in teamCursors"
              :key="member.name"
              :x="member.at.x"
              :y="member.at.y"
              :shown="member.at.shown"
              :label="member.name"
            />
          </div>
        </template>
      </LandingStage>
    </div>

    <ol
      class="mx-auto mt-6 grid max-w-4xl grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6"
      aria-label="How a drop moves between people and agents"
    >
      <li v-for="(item, position) in CHAPTERS" :key="item.label">
        <button
          type="button"
          class="group w-full text-left"
          :aria-current="position === chapter ? 'step' : undefined"
          @click="pick(item)"
        >
          <span class="block h-0.5 overflow-hidden rounded-full bg-accented">
            <span
              v-if="position === chapter"
              :key="jumps"
              class="block h-full bg-inverted"
              :class="reduced ? 'w-full' : 'origin-left [animation:grow_linear_both]'"
              :style="{ animationDuration: `${chapterMs(item)}ms`, animationPlayState: playing ? 'running' : 'paused' }"
            />
            <span v-else-if="position < chapter" class="block h-full w-full bg-(--ui-border-accented)" />
          </span>
          <span
            class="mt-2 block text-xs transition-colors"
            :class="position === chapter ? 'text-highlighted' : 'text-muted group-hover:text-highlighted'"
          >
            <span class="font-mono text-dimmed">{{ String(position + 1).padStart(2, "0") }}</span> {{ item.label }}
          </span>
        </button>
      </li>
    </ol>
  </div>
</template>
