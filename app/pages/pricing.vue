<script setup lang="ts">
// The plans, on a Drop that bills teams through Stripe (server/utils/teams.ts). Without billing there are none: 404.
const { data: plans } = await useFetch("/api/pricing")
if (!plans.value) throw createError({ statusCode: 404, statusMessage: "This Drop has no paid plans." })
useSeoMeta({
  title: "Pricing",
  description:
    "Drop is free for you and small teams. A bigger team pays per member, and everyone on it gets more room.",
})

const rows = computed(() => [
  { label: "Drops", free: "50", team: "100 per member" },
  { label: "Storage", free: "100 MiB", team: "1 GiB per member" },
  { label: "Kept forever", free: `${plans.value?.freeKept} drops at a time`, team: "Any number" },
  { label: "Team members", free: `Up to ${plans.value?.freeMembers}`, team: "Any number" },
  { label: "Team folders, comments, live editing", free: "Yes", team: "Yes" },
  { label: "Boards", free: "Yes", team: "No" },
])
</script>

<template>
  <DocsPage title="Pricing" lead="Free for you and small teams. A bigger team pays per member.">
    <div class="docs-prose">
      <table>
        <thead>
          <tr>
            <th />
            <th>Free</th>
            <th>Team, $10 per member a month</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.label">
            <td>{{ row.label }}</td>
            <td>{{ row.free }}</td>
            <td>{{ row.team }}</td>
          </tr>
        </tbody>
      </table>
      <p>
        The Team plan starts with a 14-day trial. Its price covers every member, the owner included, and changes as
        people join or leave. Stripe bills it and handles sales tax and VAT.
      </p>
      <p>
        Boards run on tldraw, whose free license doesn't cover paid use, so the Team plan has none. Boards you made
        before keep opening.
      </p>
      <p>
        Drop is open source: <NuxtLink to="/docs/self-host">host your own</NuxtLink> with no plans or limits you don't
        set.
      </p>
    </div>
  </DocsPage>
</template>
