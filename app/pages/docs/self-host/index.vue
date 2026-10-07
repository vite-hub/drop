<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

definePageMeta({ layout: "docs" })

const build = "DROP_HOST=vercel pnpm build   # cloudflare (default), vercel, netlify, deno, or vps"
const local = "pnpm install\npnpm db:migrate   # once, and after schema changes\npnpm dev          # http://localhost:3000"
const smoke = "DROP_URL=https://<your-domain> pnpm test:e2e:deployed"
</script>

<template>
  <DocsPage title="Host it yourself" lead="Drop is a Nuxt app built on ViteHub, and it runs on Cloudflare, Vercel, Netlify, Deno Deploy, or a server of your own. One setting at build time picks the host; your drops, comments, and files stay in your accounts.">
    <DocsSection id="hosts" title="Pick a host">
      <p>Cloudflare has everything Drop uses in one account. Vercel, Netlify, and Deno Deploy also need a Turso database. Every host but Cloudflare renders code images as SVG only.</p>
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
      <p><code>DROP_HOST</code> picks the host when you build. Without it, Drop builds for Cloudflare.</p>
      <AgentsCodeBlock :code="build" />
      <p><code>nuxt.config.ts</code> maps each host to its ViteHub preset and drivers: the database, file storage, rate limiting, and the hourly job that deletes expired code images. Your code doesn't change; ViteHub swaps the drivers behind <code>vite-hub/database</code>, <code>vite-hub/blob</code>, and the rest.</p>
    </DocsSection>

    <DocsSection id="github" title="Sign-in and admins">
      <p>Every Drop signs in with GitHub. <a href="https://github.com/settings/applications/new">Create a GitHub OAuth app</a> with:</p>
      <ul>
        <li><strong>Homepage URL</strong>: <code>https://&lt;your-domain&gt;</code></li>
        <li><strong>Authorization callback URL</strong>: <code>https://&lt;your-domain&gt;/api/auth/callback/github</code></li>
      </ul>
      <p>Then give the deployment these settings. Each host page says where they go.</p>
      <DocsEnv />
      <p>Anyone with a GitHub account can sign in and joins as a Member. The accounts in <code>DROP_ADMINS</code> join as Admin, and admins change roles on the Members page. To use another sign-in provider, change the Better Auth options in <code>server/auth.ts</code>.</p>
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
      <p>Every host uses SQLite. That's D1 on Cloudflare, Turso's hosted libSQL on Vercel, Netlify, and Deno Deploy, and a SQLite file on a VPS. The same migrations in <code>server/databases/migrations</code> apply to all of them:</p>
      <ul>
        <li><code>pnpm db:migrate:remote</code> applies them to D1. <code>pnpm run deploy</code> runs it for you.</li>
        <li><code>pnpm db:migrate:libsql</code> applies them to Turso (with <code>TURSO_DATABASE_URL</code> and <code>TURSO_AUTH_TOKEN</code>) or to the VPS's SQLite file. It skips the ones already applied.</li>
      </ul>
      <p>After you change the schema in <code>server/databases/</code>, <code>pnpm db:generate</code> writes the next migration.</p>
    </DocsSection>

    <DocsSection id="differences" title="What changes between hosts">
      <ul>
        <li><strong>Code images.</strong> PNG is a Cloudflare Browser Run screenshot of the SVG, so only Cloudflare has it. Elsewhere <code>create_code_image</code> returns SVG, and asking for PNG fails with a clear error.</li>
        <li><strong>Rate limits.</strong> Cloudflare uses its rate limiting binding. Other hosts count in memory, per server instance, so limits are looser on serverless hosts that run many instances.</li>
        <li><strong>Expired code images.</strong> An hourly job deletes them: a Cron Trigger on Cloudflare, a Cron Job on Vercel, a scheduled function on Netlify, and a timer in the Node process on a VPS. Deno Deploy has none; expired images stop being served but stay in the bucket.</li>
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
