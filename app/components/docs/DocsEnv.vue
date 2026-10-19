<script setup lang="ts">
// The settings every Drop needs or most often sets, plus the host's own (`extra`). Shown on each host page.
const { extra = [] } = defineProps<{ extra?: Array<[name: string, what: string]> }>()

const COMMON: Array<[string, string]> = [
  ["GITHUB_CLIENT_ID", "Your GitHub OAuth app's client ID."],
  ["GITHUB_CLIENT_SECRET", "A client secret from the same app."],
  ["BETTER_AUTH_SECRET", "Signs sessions and agent tokens. One per deployment: openssl rand -base64 32"],
  ["DROP_ADMINS", "Admin emails, comma-separated. Whoever signs in with one of them is Admin."],
  [
    "DROP_MODE",
    "Optional. team for a Drop one team runs: everyone signed in is a teammate, and new drops start shared with the Team. Defaults to personal.",
  ],
  [
    "DROP_PUBLIC_LINK_DAYS",
    "Optional. Days a public link stays open. Empty: 7 on a team Drop, no limit on a personal one. 0 turns public links off.",
  ],
]
const rows = computed(() => [...COMMON, ...extra])
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table>
      <thead>
        <tr>
          <th>Variable</th>
          <th>What it is</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="[name, what] in rows" :key="name">
          <td class="font-mono text-xs">{{ name }}</td>
          <td>{{ what }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
