<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

definePageMeta({ layout: "docs" })

const build = "DROP_HOST=vercel pnpm build   # explicit override: cloudflare, vercel, netlify, deno, or vps"
const local = "pnpm install\npnpm db:migrate   # once, and after schema changes\npnpm dev          # http://localhost:3000"
const database = "npx wrangler login\nnpx wrangler d1 create my-drop"
const smoke = "DROP_URL=https://<your-domain> pnpm test:e2e:deployed"
</script>

<template>
  <DocsPage title="Host it yourself" lead="Run your own Drop on Cloudflare, Vercel, Netlify, Deno Deploy, or a VPS.">
    <DocsDeployButtons />

    <p>Start with the button for your host. You still supply GitHub sign-in and your admin user id. The steps below cover those values and the database.</p>

    <DocsSection id="github" title="Sign-in and admins">
      <p>Drop signs in with GitHub. You can also <NuxtLink to="/docs/self-host/vps#auth-proxy">reuse an existing GitHub oauth2-proxy</NuxtLink>. For native sign-in, <a href="https://github.com/settings/applications/new">Create a GitHub OAuth app</a> with:</p>
      <ul>
        <li><strong>Homepage URL</strong>: <code>https://&lt;your-domain&gt;</code></li>
        <li><strong>Authorization callback URL</strong>: <code>https://&lt;your-domain&gt;/api/auth/callback/github</code></li>
      </ul>
      <p>Then give the deployment these settings. Each host page says where they go.</p>
      <DocsEnv />
      <p>By default, anyone with a GitHub account can sign in and joins as a Member. Set <code>DROP_GITHUB_ORG</code> to require active organization membership for publishing and viewing, including shared links and MCP. GitHub sign-in then requests <code>read:org</code>. The accounts in <code>DROP_ADMINS</code> join as Admin, and admins change roles on the Members page. To use another sign-in provider, change the Better Auth options in <code>server/auth.ts</code>.</p>
      <div class="overflow-x-auto rounded-lg border border-default">
        <table>
          <thead><tr><th>Role</th><th>What they can do</th></tr></thead>
          <tbody>
            <tr v-for="role in ROLES" :key="role"><td>{{ ROLE_LABELS[role] }}</td><td>{{ ROLE_SUMMARY[role] }}</td></tr>
          </tbody>
        </table>
      </div>
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
      <p>After you change the schema in <code>server/databases/</code>, <code>pnpm db:generate</code> writes the next migration.</p>
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
        <li><strong>Expired code images.</strong> An hourly job deletes them on Cloudflare, Netlify, and a VPS. Vercel runs cleanup daily so it works on Hobby. Deno Deploy has none; expired images stop being served but stay in the bucket.</li>
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
