<script setup lang="ts">
// The hero: drops arriving from agents and people, the way your Drops page fills up.
type FeedEvent = { actor: string; kind: "agent" | "browser"; verb: string; title: string; icon: string; tag: string }

const FEED: FeedEvent[] = [
  { actor: "Claude Code", kind: "agent", verb: "dropped a plan", title: "Auth for Drop, stacked rollout", icon: "markdown", tag: "Private" },
  { actor: "Codex", kind: "agent", verb: "published an app", title: "launch-board/", icon: "app", tag: "7 files" },
  { actor: "Ana", kind: "browser", verb: "commented", title: "Ship the skill update in the same PR?", icon: "comment", tag: "Open" },
  { actor: "You", kind: "browser", verb: "shared", title: "launch-board/", icon: "share", tag: "Can comment" },
  { actor: "Claude Code", kind: "agent", verb: "dropped v2", title: "Auth for Drop, stacked rollout", icon: "markdown", tag: "1 resolved" },
  { actor: "Cursor", kind: "agent", verb: "dropped a report", title: "Pricing experiment readout", icon: "html", tag: "Private" },
]

// KIND_ICONS is looked up at runtime, so the icon scanner can't see it. These literals keep the kinds used here
// in the client bundle: i-lucide-file-text i-lucide-folder i-lucide-code
const eventIcon = (icon: string) =>
  icon === "comment" ? "i-lucide-message-circle" : icon === "share" ? "i-lucide-globe" : (KIND_ICONS[icon] ?? "i-lucide-file")
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-default bg-default shadow-xl shadow-black/4">
    <div class="flex h-11 items-center gap-2 border-b border-default px-4 text-sm">
      <UIcon name="i-lucide-layers" class="size-4 text-muted" />
      <span class="font-medium text-highlighted">Drops</span>
      <span class="label-mono ml-auto flex items-center gap-1.5">
        <span class="relative flex size-1.5">
          <span class="absolute inset-0 animate-ping rounded-full bg-inverted/40 motion-reduce:hidden" />
          <span class="size-1.5 rounded-full bg-inverted" />
        </span>
        Live
      </span>
    </div>
    <div class="h-[18.5rem] overflow-hidden">
      <LandingAnimatedList :items="FEED" :visible="4">
        <template #default="{ item: event }">
          <div class="flex h-[4.625rem] items-center gap-3 border-b border-default px-4">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated ring-1 ring-inset ring-(--ui-border)">
              <AgentIcon v-if="event.kind === 'agent'" :name="event.actor" kind="agent" class="size-[18px]" />
              <span v-else class="grid size-6 place-items-center rounded-full bg-default text-[10px] font-semibold text-highlighted ring-1 ring-inset ring-(--ui-border)">
                {{ event.actor.slice(0, 1).toUpperCase() }}
              </span>
            </span>
            <div class="min-w-0 flex-1">
              <p class="flex min-w-0 items-center gap-1.5 text-sm font-medium text-highlighted">
                <UIcon :name="eventIcon(event.icon)" class="size-3.5 shrink-0 text-muted" />
                <span class="truncate">{{ event.title }}</span>
              </p>
              <p class="mt-0.5 truncate text-xs text-muted">{{ event.actor }} {{ event.verb }} · just now</p>
            </div>
            <UBadge
              color="neutral"
              variant="outline"
              class="shrink-0 rounded-full"
              :class="event.tag === 'Private' && 'text-muted'"
              :icon="event.tag === 'Private' ? 'i-lucide-lock' : undefined"
              :label="event.tag"
            />
          </div>
        </template>
      </LandingAnimatedList>
    </div>
  </div>
</template>
