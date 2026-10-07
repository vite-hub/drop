<script setup lang="ts">
// The settings every Drop needs, plus the host's own (`extra`). Shown on each host page.
const props = withDefaults(defineProps<{ extra?: Array<[name: string, what: string]> }>(), { extra: () => [] })

const COMMON: Array<[string, string]> = [
  ["GITHUB_CLIENT_ID", "Your GitHub OAuth app's client ID."],
  ["GITHUB_CLIENT_SECRET", "A client secret from the same app."],
  ["BETTER_AUTH_SECRET", "Signs sessions and agent tokens. One per deployment: openssl rand -base64 32"],
  ["DROP_ADMINS", "GitHub user ids that join as Admin, comma-separated: gh api users/<login> --jq .id"],
]
const rows = computed(() => [...COMMON, ...props.extra])
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table>
      <thead><tr><th>Variable</th><th>What it is</th></tr></thead>
      <tbody>
        <tr v-for="[name, what] in rows" :key="name"><td class="font-mono text-xs">{{ name }}</td><td>{{ what }}</td></tr>
      </tbody>
    </table>
  </div>
</template>
