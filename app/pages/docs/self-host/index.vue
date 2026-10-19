<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

definePageMeta({ layout: "docs" })

const build = "DROP_HOST=vercel pnpm build   # explicit override: cloudflare, vercel, netlify, deno, or vps"
const local = "pnpm install\npnpm db:migrate   # once, and after schema changes\npnpm dev          # http://localhost:3000"
const database = "npx wrangler login\nnpx wrangler d1 create my-drop"
const smoke = "DROP_URL=https://<your-domain> pnpm test:e2e:deployed"
const team = "DROP_MODE=team\nDROP_ADMINS=you@example.com\nDROP_GITHUB_ORG=your-org\nDROP_PUBLIC_LINK_DAYS=7"
</script>

<template>
  <DocsPage title="Host it yourself" lead="Run your own Drop on Cloudflare, Vercel, Netlify, Deno Deploy, or a VPS.">
    <DocsDeployButtons />

    <p>Start with the button for your host. You still supply GitHub sign-in and your admin email. The steps below cover those values and the database.</p>

    <DocsSection id="github" title="Sign-in and admins">
      <p>Drop signs in with GitHub. You can also <NuxtLink to="/docs/self-host/vps#auth-proxy">reuse an existing GitHub oauth2-proxy</NuxtLink>. For native sign-in, <a href="https://github.com/settings/applications/new">Create a GitHub OAuth app</a> with:</p>
      <ul>
        <li><strong>Homepage URL</strong>: <code>https://&lt;your-domain&gt;</code></li>
        <li><strong>Authorization callback URL</strong>: <code>https://&lt;your-domain&gt;/api/auth/callback/github</code></li>
      </ul>
      <p>Then give the deployment these settings. Each host page says where they go. Drop reads its settings when it runs, so changing one needs a restart, not a rebuild; only the host and database choices below are fixed at build time. Each setting also answers to a <code>VITEHUB_</code> name, such as <code>VITEHUB_DROP_GITHUB_ORG</code>, which wins when both are set. Booleans take <code>true</code>, <code>false</code>, <code>1</code>, or <code>0</code>, and an invalid value stops Drop with an error naming the setting.</p>
      <DocsEnv />
      <p>By default, anyone with a GitHub account can sign in and joins as a Member. Set <code>DROP_GITHUB_ORG</code> to require active organization membership for publishing and viewing, including shared links and MCP. GitHub sign-in then requests <code>read:org</code>.</p>
      <p><code>DROP_ADMINS</code> lists admin emails, separated by commas or spaces; case doesn't matter. Whoever signs in with one of them is an Admin, as long as their sign-in method verified the email, so an admin stays one after switching from GitHub to another provider. Drop reads the list on every request: to add or remove an admin, change it and restart. Nobody changes roles on the Members page; admins ban and unban members there. In <code>nuxt dev</code> and with <code>DROP_TEST_SIGNIN</code>, an unverified email counts too. To use another sign-in provider, change the Better Auth options in <code>server/auth.ts</code>.</p>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>Role</th><th>What they can do</th></tr></thead>
          <tbody>
            <tr v-for="role in ROLES" :key="role"><td>{{ ROLE_LABELS[role] }}</td><td>{{ ROLE_SUMMARY[role] }}</td></tr>
          </tbody>
        </table>
      </div>
    </DocsSection>

    <DocsSection id="team-mode" title="Team mode">
      <p>By default a Drop is personal, like drop.vitehub.dev: drops start Only me, and people share them by public link. Set <code>DROP_MODE=team</code> for a Drop that one team runs for itself, usually behind <code>DROP_GITHUB_ORG</code> or <NuxtLink to="/docs/self-host/vps#auth-proxy">oauth2-proxy</NuxtLink>. Everyone signed in is then a teammate:</p>
      <ul>
        <li>New drops start shared with the Team: everyone signed in opens them and comments. People pick Only me to keep a draft to themselves, or Team can edit to edit a Markdown doc together.</li>
        <li>The sidebar leads with Team. Its tab lists the team's folders, then teammates' drops shared with the team.</li>
        <li>Admins create team folders in the browser: <strong>New › Folder</strong> with the team's folder switch on, or <strong>New team folder</strong> on an empty Team tab. Everyone on the team, and their agents, adds drops to them. A drop in a team folder stays its publisher's and counts against their plan. Team folders never expire and can't be Only me.</li>
        <li>Only admins rename, describe, share, or trash a team folder, and add subfolders to it. Anyone on the team can move a drop in one to the Trash from the browser; it goes to its owner's Trash, where the owner or an admin restores it.</li>
      </ul>
      <p>Every folder has a description of what goes in it and how to name and write it, such as "Notes from calls, one doc per meeting, named YYYY-MM-DD-topic." Admins write the team folders' descriptions. Agents read them with <code>list_folders</code> before they publish, and put each new drop in the folder that fits.</p>
      <p><code>DROP_PUBLIC_LINK_DAYS</code> sets how many days a public link stays open. Left empty, it's 7 on a team Drop and no limit on a personal one; <code>0</code> turns public links off. When a link closes, the drop falls back to Team on a team Drop, or Only me on a personal one, and picking Public again starts the window over. This is separate from a drop's lifetime, which decides when the drop itself goes to the Trash.</p>
      <p>A team deployment's settings:</p>
      <AgentsCodeBlock :code="team" />
    </DocsSection>

    <DocsSection id="content-origin" title="Give apps their own domain">
      <p>Apps and HTML docs run their own scripts. By default Drop shows them in a sandbox with no origin, so they can't reach Drop or the reader's session. That sandbox also blocks <code>localStorage</code>, cookies, and URL changes. Drop swaps in temporary storage, but an app that routes by its URL still breaks.</p>
      <p>Set <code>DROP_CONTENT_ORIGIN</code> to a wildcard such as <code>https://*.drop-usercontent.example.com</code> and serve every hostname under it from the same deployment. Each drop then runs on a subdomain of its own, the way each app on a static host gets its own site: storage and history work, and one app can't read what another stored. The subdomain is a hash of the drop's id, never the id itself, because hostnames are visible on the network and a shared drop's id opens its link.</p>
      <ul>
        <li>Use a domain that serves nothing else. A separate registrable domain is the strongest boundary, because a page can set cookies for its parent domain: under <code>example.com</code>, apps could set cookies that reach <code>example.com</code> and every other drop. Drop's sign-in cookies use the <code>__Host-</code> prefix, so no subdomain can replace them, and API writes that carry cookies must come from Drop's own origin.</li>
        <li>The wildcard needs a wildcard DNS record and a certificate that covers it. Cloudflare's free certificate covers one level under the zone, so <code>*.drop-usercontent.example.com</code> needs a paid one. To stay on your own domain for free, put the <code>*</code> inside the first label instead: <code>https://*-drop.example.com</code> runs each drop at <code>&lt;hash&gt;-drop.example.com</code>, and only names ending in <code>-drop</code> reach Drop.</li>
        <li>The hostnames only serve a blank page. The viewer sends each document to it, so private drops never pass through them and they need no sign-in. Keep them outside oauth2-proxy or any other login wall.</li>
        <li>A plain hostname (<code>https://drop-usercontent.example.com</code>) also works, but then every drop shares that one origin, so an app can read what another app stored in the same browser.</li>
      </ul>
    </DocsSection>

    <DocsSection id="expiry" title="Expiry">
      <p>Drops expire 30 days after their last visit (14 for temporary ones) into the Trash, stay restorable for 15 days, and are then deleted by the hourly cleanup job. <NuxtLink to="/docs/review#expiry">Review and share</NuxtLink> explains what counts as a visit.</p>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>Variable</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td class="font-mono text-xs">DROP_EXPIRY_DAYS</td><td>Days a drop lives after its last visit. Defaults to 30. Set 0 to keep every drop.</td></tr>
            <tr><td class="font-mono text-xs">DROP_CUSTOM_EXPIRY</td><td>Set false so only admins can keep drops. Defaults to true: owners and their agents can too.</td></tr>
          </tbody>
        </table>
      </div>
      <p>Shortening the window applies to existing drops at once.</p>
    </DocsSection>

    <DocsSection id="abuse" title="Abuse and moderation">
      <p>On a Drop open to anyone with a GitHub account, set <code>DROP_SHARE_APPROVAL=true</code> so a member's public links wait until an admin approves that member. Everything else keeps working: on a team Drop, a public link waiting for review still reaches the team. Admins skip the wait. Approve or reject members on <code>/admin/review</code>; once approved, a member shares freely. Links shared before you turn it on stay shared, so approve trusted members first if they'll publish new versions.</p>
      <p>Anyone can report a shared link at <code>/report</code>. Reports land on <code>/admin/reports</code>, where admins dismiss them, quarantine the reported drop, or ban its owner, which takes down all of their drops. Each report also logs a high-severity event; Drop sends no email, so watch your logs. <code>DROP_ABUSE_EMAIL</code> adds a public contact address to the abuse page.</p>
      <p>Before opening your Drop to the public, adapt the templates in <code>app/pages/terms.vue</code>, <code>acceptable-use.vue</code>, and <code>abuse.vue</code> to your jurisdiction, including a DMCA contact if you need one. Drops and their files are kept out of search engines.</p>
    </DocsSection>

    <DocsSection id="logs" title="Logs">
      <p>Drop writes one structured <a href="https://www.evlog.dev">evlog</a> event per request: who called, which agent, what it did, and why it failed. MCP tool calls, purges from the Trash, and abuse reports land there too. On Cloudflare they're in Workers Logs; elsewhere they go to the host's log output.</p>
    </DocsSection>

    <DocsSection id="database" title="Database and migrations">
      <p>Docker and VPS builds default to local SQLite on persistent disk. The other hosts use separate Cloudflare D1 databases, with D1's HTTP API outside Cloudflare. The same migrations in <code>server/databases/migrations</code> apply to all of them:</p>
      <p>For a deployment that uses D1 outside Cloudflare, create it from a machine with Node.js:</p>
      <AgentsCodeBlock :code="database" />
      <p>Copy its id and name, your Cloudflare account id, and an account API token with Account, D1, Edit permission into the host's settings. Limit the token to your account.</p>
      <p>From your cloned repository, <code>pnpm db:migrate:d1</code> needs <code>CLOUDFLARE_ACCOUNT_ID</code>, <code>CLOUDFLARE_API_TOKEN</code>, and <code>CLOUDFLARE_D1_DATABASE_ID</code> in its environment. It records migrations in <code>d1_migrations</code> and skips those already applied.</p>
      <ul>
        <li>Cloudflare's button runs <code>pnpm run deploy</code>, which applies migrations by the <code>DB</code> binding. Existing Workers Builds using <code>npx wrangler deploy</code> still need <code>pnpm db:migrate:remote</code> after schema changes.</li>
        <li>Vercel and Netlify run <code>pnpm db:migrate:d1</code> after building, before publishing.</li>
        <li>Deno runs it as a pre-deploy command. Docker Compose uses Drizzle for SQLite, or this command for an explicit D1 build, before starting Drop.</li>
      </ul>
      <p>Use a separate D1 database for previews, or disable preview deployments. A build with production D1 credentials migrates that database.</p>
      <p>Drop keeps its whole schema in one file, <code>0000_init.sql</code>, which creates a new database. A database created from an earlier release doesn't pick up later schema changes on its own: apply them by hand. After you change the schema in <code>server/databases/</code>, <code>pnpm db:generate</code> writes the next migration.</p>
    </DocsSection>

    <DocsSection id="hosts" title="Pick a host">
      <p>Cloudflare has everything Drop uses in one account. VPS builds can keep all data on local disk; the serverless hosts use D1 over HTTP with a separate database per deployment. Every host but Cloudflare renders code images as SVG only.</p>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>Host</th><th>Database</th><th>Files</th><th>Rate limits</th><th>Code images</th></tr></thead>
          <tbody>
            <tr v-for="host in HOSTS" :key="host.id">
              <td><NuxtLink :to="`/docs/self-host/${host.id}`">{{ host.name }}</NuxtLink></td>
              <td>{{ host.database }}</td>
              <td>{{ host.files }}</td>
              <td>{{ host.rateLimits }}</td>
              <td>{{ host.codeImages }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocsSection>

    <DocsSection id="build" title="Choose the host at build time">
      <p><code>DROP_HOST</code> explicitly picks the host when you build. Otherwise Drop detects <code>NITRO_PRESET</code> or <code>SERVER_PRESET</code>, then Vercel, Netlify, or Deno environment markers. A local <code>DROP_DATABASE_URL</code> selects VPS when no host is selected. With no signal, it builds for Cloudflare. Docker always selects VPS.</p>
      <AgentsCodeBlock :code="build" />
      <p>Use <code>DROP_DATABASE=sqlite</code> or <code>DROP_DATABASE=d1</code> to choose the database at build time. SQLite requires the VPS preset and persistent disk. An existing D1 database id keeps a VPS build on D1. Rebuild to change drivers and migrate data separately.</p>
      <p><code>nuxt.config.ts</code> maps each host to its ViteHub preset and drivers: the database, file storage, rate limiting, and the job that deletes expired code images. Your code doesn't change; ViteHub swaps the drivers behind <code>vite-hub/database</code>, <code>vite-hub/blob</code>, and the rest.</p>
    </DocsSection>

    <DocsSection id="differences" title="What changes between hosts">
      <ul>
        <li><strong>Code images.</strong> PNG is a Cloudflare Browser Run screenshot of the SVG, so only Cloudflare has it. Elsewhere <code>create_code_image</code> returns SVG, and asking for PNG fails with a clear error.</li>
        <li><strong>Rate limits.</strong> Cloudflare uses its rate limiting binding. Other hosts count in memory, per server instance, so limits are looser on serverless hosts that run many instances.</li>
        <li><strong>Cleanup.</strong> An hourly job moves expired drops to the Trash, deletes what has been there 15 days, and removes expired code images and OAuth clients unused for a day. Vercel runs it daily so it works on Hobby. Deno Deploy has none; trashed drops and expired images stop being served but stay in the bucket.</li>
        <li><strong>Caching.</strong> Rendered Markdown and the file count are cached in Workers KV on Cloudflare, and in memory elsewhere.</li>
      </ul>
    </DocsSection>

    <DocsSection id="check" title="Check a deployment">
      <p>The smoke test checks the public pages, the OAuth discovery documents, that <code>/mcp</code> asks agents to sign in, and the skills index:</p>
      <AgentsCodeBlock :code="smoke" />
      <p>Add <code>DROP_TOKEN=&lt;an MCP access token&gt;</code> to also run the signed-in flow: uploads, sharing, and MCP tools.</p>
    </DocsSection>

    <DocsSection id="develop" title="Develop locally">
      <AgentsCodeBlock :code="local" />
      <p>Local dev runs against a local D1 and keeps files in <code>.vitehub/data/blob</code>. It has no GitHub app, so it also allows email and password sign-in: open <code>/?signin=1</code>.</p>
    </DocsSection>
  </DocsPage>
</template>
