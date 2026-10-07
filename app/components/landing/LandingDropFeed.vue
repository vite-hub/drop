<script setup lang="ts">
// The hero visual: one drop where an agent's version and a person's feedback meet.
type FeedEvent = { actor: string; kind: "agent" | "browser"; verb: string; title: string; icon: string }

const FEED: FeedEvent[] = [
  { actor: "Codex", kind: "agent", verb: "dropped v1", title: "launch-board/", icon: "app" },
  { actor: "Ana", kind: "browser", verb: "commented", title: "Move the CTA above the fold", icon: "comment" },
  { actor: "Codex", kind: "agent", verb: "dropped v2", title: "launch-board/", icon: "app" },
  { actor: "You", kind: "browser", verb: "shared", title: "launch-board/", icon: "share" },
  { actor: "Claude Code", kind: "agent", verb: "read 2 comments", title: "pricing-notes.md", icon: "markdown" },
]

// KIND_ICONS is looked up at runtime, so the icon scanner can't see it. These literals keep the kinds used here
// in the client bundle: i-lucide-file-text i-lucide-folder
const eventIcon = (icon: string) => icon === "comment" ? "i-lucide-message-circle" : icon === "share" ? "i-lucide-globe" : (KIND_ICONS[icon] ?? "i-lucide-file")
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-default bg-default shadow-xl shadow-black/4">
    <div class="flex h-11 items-center gap-2 border-b border-default px-4 text-sm">
      <UIcon name="i-lucide-layers" class="size-4 text-muted" />
      <span class="font-medium text-highlighted">launch-board/</span>
      <span class="label-mono ml-auto flex items-center gap-1.5">
        <span class="relative flex size-1.5">
          <span class="absolute inset-0 animate-ping rounded-full bg-inverted/40 motion-reduce:hidden" />
          <span class="size-1.5 rounded-full bg-inverted" />
        </span>
        v2 live
      </span>
    </div>
    <div class="grid gap-0 sm:grid-cols-[1.08fr_.92fr]">
      <div class="relative min-h-64 border-b border-default bg-muted p-4 sm:border-r sm:border-b-0">
        <div class="rounded-lg border border-default bg-default shadow-sm">
          <div class="flex items-center gap-1.5 border-b border-default px-3 py-2">
            <span class="size-2 rounded-full bg-accented" /><span class="size-2 rounded-full bg-accented" /><span class="size-2 rounded-full bg-accented" />
            <span class="ml-2 truncate font-mono text-[10px] text-muted">launch-board/index.html</span>
          </div>
          <div class="space-y-3 p-4">
            <div class="h-2.5 w-20 rounded bg-accented" />
            <div class="h-5 w-4/5 rounded bg-elevated" />
            <div class="h-2 w-3/5 rounded bg-accented" />
            <div class="mt-6 h-16 rounded-md border border-default bg-muted p-3">
              <div class="h-2 w-2/5 rounded bg-accented" />
              <div class="mt-2 h-2 w-4/5 rounded bg-accented" />
              <div class="mt-2 h-2 w-3/5 rounded bg-accented" />
            </div>
            <div class="flex items-center justify-between pt-1">
              <span class="h-7 w-20 rounded-md bg-inverted" />
              <span class="h-2 w-16 rounded bg-accented" />
            </div>
          </div>
          <div class="absolute top-36 left-[58%] flex items-center gap-1.5 rounded-full border border-default bg-default px-2 py-1 text-[10px] shadow-md">
            <span class="grid size-4 place-items-center rounded-full bg-inverted text-[8px] font-semibold text-inverted">A</span>
            <span class="text-highlighted">Move the CTA up</span>
          </div>
          <div class="absolute right-7 bottom-12 flex items-center gap-1.5 text-[10px] text-muted">
            <UIcon name="i-lucide-mouse-pointer-2" class="size-4 text-highlighted" /> Ana is here
          </div>
        </div>
        <div class="mt-3 flex items-center gap-2 text-xs text-muted">
          <AgentIcon name="Codex" kind="agent" class="size-4" /> Codex is reading the open comments
        </div>
      </div>

      <div class="min-w-0 p-4">
        <p class="label-mono mb-3">The drop's thread</p>
        <LandingAnimatedList :items="FEED" :visible="4" :interval="2800">
          <template #default="{ item: event }">
            <div class="relative flex gap-2.5 pb-4 last:pb-0">
              <div class="relative z-10 grid size-7 shrink-0 place-items-center rounded-full bg-elevated ring-1 ring-inset ring-(--ui-border)">
                <AgentIcon v-if="event.kind === 'agent'" :name="event.actor" kind="agent" class="size-3.5" />
                <span v-else class="text-[10px] font-semibold text-highlighted">{{ event.actor.slice(0, 1) }}</span>
              </div>
              <span v-if="event !== FEED[FEED.length - 1]" class="absolute top-7 bottom-0 left-3.5 w-px bg-(--ui-border)" />
              <div class="min-w-0 flex-1 pt-0.5">
                <p class="truncate text-xs font-medium text-highlighted">{{ event.actor }} {{ event.verb }}</p>
                <p class="mt-0.5 truncate text-[11px] text-muted">{{ event.title }}</p>
              </div>
              <UIcon :name="eventIcon(event.icon)" class="mt-1 size-3.5 shrink-0 text-muted" />
            </div>
          </template>
        </LandingAnimatedList>
      </div>
    </div>
  </div>
</template>
