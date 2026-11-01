<script setup lang="ts">
// What Drop costs under its license (LICENSE): free for one or two people, $9 per member a month from three. A Drop
// that bills its own teams through Stripe (server/utils/teams.ts) also shows that Team plan; without billing,
// /api/pricing is a 404 and the page shows the license alone.
const { data: plans } = await useFetch("/api/pricing")

const LICENSE_URL = "https://github.com/vite-hub/drop/blob/main/LICENSE"
const CONTACT = "mailto:hello@onmax.me?subject=Drop%20license"

const TIERS = [
  {
    name: "Free",
    price: "$0",
    items: [
      "For one person, or two working together",
      "Run your own Drop, or use drop.vitehub.dev",
      "Everything Drop does",
    ],
    action: { label: "Self-hosting guide", to: "/docs/self-host" },
  },
  {
    name: "Team",
    price: "$9",
    unit: "per member a month",
    items: ["For 3 or more people", "Run your own Drop for the whole team", "Everything Drop does"],
    action: { label: "Email hello@onmax.me", to: CONTACT },
  },
]

const rows = computed(() => [
  { label: "Drops", free: "50", team: "Any number" },
  { label: "Storage", free: "100 MiB", team: "1 GiB per member" },
  { label: "Kept forever", free: `${plans.value?.freeKept} drops at a time`, team: "Any number" },
  { label: "Team members", free: `Up to ${plans.value?.freeMembers}`, team: "Any number" },
  { label: "Team folders, comments, live editing, boards", free: "Yes", team: "Yes" },
])
</script>

<template>
  <DocsPage title="Pricing" lead="Free for one or two people. A team of 3 or more pays $9 per member a month.">
    <div class="grid gap-4 sm:grid-cols-2">
      <section
        v-for="tier in TIERS"
        :key="tier.name"
        :aria-labelledby="`tier-${tier.name}`"
        class="flex flex-col rounded-lg border border-default p-5"
      >
        <h2 :id="`tier-${tier.name}`" class="text-sm font-medium text-highlighted">{{ tier.name }}</h2>
        <p class="mt-3 flex items-baseline gap-1.5">
          <span class="text-3xl font-semibold tracking-tight text-highlighted">{{ tier.price }}</span>
          <span v-if="tier.unit" class="text-sm text-muted">{{ tier.unit }}</span>
        </p>
        <ul class="mt-5 flex-1 space-y-2 text-sm text-toned">
          <li v-for="item in tier.items" :key="item" class="flex gap-2">
            <UIcon name="i-mingcute-check-line" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
          </li>
        </ul>
        <UButton
          class="mt-6 self-start"
          color="neutral"
          variant="outline"
          size="sm"
          :label="tier.action.label"
          :to="tier.action.to"
        />
      </section>
    </div>

    <div class="docs-prose">
      <h2 id="who-counts">Who counts</h2>
      <p>
        <strong>Everyone who has an account on, or signs in to, any Drop run by you or for you counts</strong>, added up
        across all those Drops. Your organization includes you, your employees and contractors, and every entity that
        controls, is controlled by, or is under common control with you. People outside your organization who only view
        or comment on content shared with them don't count. Agents act for the person who connected them, so they don't
        count on their own.
      </p>
      <h2 id="buy">Buying a license</h2>
      <p>
        <strong>Email <a :href="CONTACT">hello@onmax.me</a></strong> with how many people will use Drop, and we'll sort
        out the rest. Trying Drop out is free at any size; a team of 3 or more needs the license once it uses Drop for
        real work.
      </p>
      <h2 id="license">The license</h2>
      <p>
        Drop's code is public under the <a :href="LICENSE_URL">Business Source License 1.1</a>: you can read it, change
        it, and run it on these terms. Each version becomes Apache-2.0 four years after it's published. Running Drop as
        a hosted service for others needs a license at any size.
      </p>
    </div>

    <div v-if="plans" class="docs-prose">
      <h2 id="this-drop">Teams on this Drop</h2>
      <table>
        <thead>
          <tr>
            <th><span class="sr-only">Limit</span></th>
            <th>Free</th>
            <th>Team, $9 per member a month</th>
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
    </div>
  </DocsPage>
</template>
