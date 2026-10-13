<script setup lang="ts">
import { TYPESET_CSS } from "#shared/typeset"
import type { SkillDetail } from "#shared/types"

definePageMeta({ layout: "dashboard", middleware: "auth" })

const route = useRoute()
const router = useRouter()
const name = computed(() => String(route.params.name))
const { data: skill, error } = await useApi<SkillDetail>(() => `/api/skills/${name.value}`, { key: `skill:${name.value}` })
if (error.value) throw createError({ statusCode: error.value.statusCode ?? 404, statusMessage: "No skill with that name." })
useSeoMeta({ title: () => skill.value?.name ?? "Skill" })
// Name Tailwind's layer order first: whichever stylesheet declares a layer first fixes the order, and typeset's
// `components` layer must stay after Tailwind's `base` reset.
useHead({ style: [{ key: "typeset", innerHTML: `@layer theme, base, components, utilities;\n${TYPESET_CSS}` }] })

const { data: me } = useMe()
const admin = computed(() => me.value?.role === "admin")
const { setEnabled } = useSkills()
const { copy } = useCopy()

// The open file lives in the URL, so a link can point at a reference.
const path = computed({
  get: () => (typeof route.query.file === "string" && skill.value?.files.some(file => file.path === route.query.file) ? route.query.file : "SKILL.md"),
  set: file => router.replace({ query: file === "SKILL.md" ? {} : { file } }),
})
const file = computed(() => skill.value?.files.find(item => item.path === path.value))
const folders = computed(() => {
  const groups = new Map<string, string[]>()
  for (const item of skill.value?.files ?? []) {
    const at = item.path.lastIndexOf("/")
    const folder = at === -1 ? "" : item.path.slice(0, at)
    groups.set(folder, [...(groups.get(folder) ?? []), item.path])
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b))
})
const basename = (file: string) => file.slice(file.lastIndexOf("/") + 1)
</script>

<template>
  <PageShell v-if="skill" id="skill" :title="skill.name" :description="skill.description" wide>
    <template #actions>
      <UBadge :color="skill.enabled ? 'success' : 'neutral'" variant="subtle">{{ skill.enabled ? "On" : "Off" }}</UBadge>
      <USwitch v-if="admin" :model-value="skill.enabled" :aria-label="`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`" @update:model-value="value => setEnabled(skill!, value)" />
    </template>

    <div class="mb-6 flex items-center gap-2 rounded-md border border-default bg-muted py-1 pr-1 pl-3">
      <span class="label-mono">MCP</span>
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted">{{ skill.uri }}</span>
      <UButton aria-label="Copy the skill URI" color="neutral" icon="i-lucide-copy" size="xs" variant="ghost" @click="copy(skill.uri, 'Skill URI copied')" />
    </div>

    <div class="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Files" class="flex flex-col gap-3 text-sm">
        <div v-for="[folder, files] in folders" :key="folder">
          <p v-if="folder" class="mb-1 flex items-center gap-1.5 px-2 text-xs text-muted">
            <UIcon name="i-lucide-folder" class="size-3.5" />{{ folder }}
          </p>
          <button
            v-for="item in files"
            :key="item"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs transition-colors"
            :class="[folder && 'pl-6', item === path ? 'bg-elevated text-highlighted' : 'text-muted hover:bg-elevated hover:text-highlighted']"
            :aria-current="item === path ? 'page' : undefined"
            @click="path = item"
          >
            <UIcon name="i-lucide-file-text" class="size-3.5 shrink-0" />{{ basename(item) }}
          </button>
        </div>
      </nav>

      <section v-if="file" class="min-w-0 rounded-lg border border-default">
        <header class="flex items-center justify-between gap-2 border-b border-default py-1.5 pr-1.5 pl-4">
          <span class="truncate font-mono text-xs text-muted">{{ file.path }}</span>
          <UButton color="neutral" icon="i-lucide-copy" label="Copy" size="xs" variant="ghost" @click="copy(file.text, `${basename(file.path)} copied`)" />
        </header>
        <!-- Built-in skill files Drop ships, rendered by its own Markdown pipeline. -->
        <div v-if="file.html" class="typeset px-6 py-5" v-html="file.html" />
        <pre v-else class="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed"><code>{{ file.text }}</code></pre>
      </section>
    </div>
  </PageShell>
</template>
