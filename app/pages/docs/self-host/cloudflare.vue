<script setup lang="ts">
definePageMeta({ layout: "docs" })

const STEPS = {
  clone: "npx giget gh:vite-hub/drop my-drop\ncd my-drop\npnpm install\npnpm exec wrangler login",
  resources: "pnpm exec wrangler d1 create vitehub-drop   # prints the database id\npnpm exec wrangler r2 bucket create vitehub-drop",
  env: "cp .env.example .env",
  deploy: "pnpm build && pnpm run deploy",
  smoke: "DROP_URL=https://<your-domain> pnpm test:e2e:deployed",
}
</script>

<template>
  <DocsPage title="Deploy to Cloudflare" lead="Drop's default host. One Worker with D1, R2, KV, rate limiting, Browser Run, and a Cron Trigger, all in your Cloudflare account.">
    <DocsDeployButtons host="cloudflare" />

    <DocsSection id="button" title="Deploy with the button">
      <p>The button clones Drop into your GitHub account, creates D1, R2, and KV, and asks for the four sign-in settings below. It builds, applies migrations, and deploys the Worker. Enable R2 and Browser Run in your Cloudflare account first; they may require billing.</p>
      <ol>
        <li>Choose a Worker name and note its <code>https://&lt;worker&gt;.&lt;subdomain&gt;.workers.dev</code> address.</li>
        <li><NuxtLink to="/docs/self-host#github">Create a GitHub OAuth app</NuxtLink> with that address and callback <code>&lt;origin&gt;/api/auth/callback/github</code>. Supply its client id and secret, <code>BETTER_AUTH_SECRET</code> from <code>openssl rand -base64 32</code>, and <code>DROP_ADMINS</code> with the admins' emails.</li>
        <li>Accept <code>pnpm build</code> as the build command and <code>pnpm run deploy</code> as the deploy command. If you add a custom domain later, update the OAuth app's homepage and callback.</li>
      </ol>
      <p>The root <code>wrangler.jsonc</code> describes resources for the button. Cloudflare writes their new ids there. ViteHub generates <code>.output/server/wrangler.json</code> during the build; Drop carries the template's resource names and ids into that file. <code>CLOUDFLARE_D1_DATABASE_ID</code> still takes priority, so existing Workers Builds keep their current database.</p>
    </DocsSection>

    <DocsHostFacts host="cloudflare" />

    <DocsSection id="need" title="What you need">
      <ul>
        <li>A Cloudflare account.</li>
        <li>Node.js 24 and pnpm.</li>
        <li>A GitHub OAuth app with the callback <code>https://&lt;your-domain&gt;/api/auth/callback/github</code>. Use your <code>workers.dev</code> address until you add a domain.</li>
      </ul>
    </DocsSection>

    <DocsSection id="steps" title="Deploy from the terminal">
      <ol>
        <li>
          <p>Get the code and sign in to Cloudflare:</p>
          <AgentsCodeBlock :code="STEPS.clone" />
        </li>
        <li>
          <p>Create the database and the bucket. Copy the database id into <code>CLOUDFLARE_D1_DATABASE_ID</code> in the next step.</p>
          <AgentsCodeBlock :code="STEPS.resources" />
          <p>The KV namespace for Drop's render cache has no id to fill in. Wrangler creates it on the first deploy.</p>
        </li>
        <li>
          <p>Fill <code>.env</code> with the settings below. Uncomment the D1 database id and name:</p>
          <AgentsCodeBlock :code="STEPS.env" />
        </li>
        <li>
          <p>Deploy. It builds, applies the D1 migrations, and publishes the Worker with <code>.env</code> as its secrets:</p>
          <AgentsCodeBlock :code="STEPS.deploy" />
        </li>
        <li>Add your domain to the Worker (Workers and Pages, your Worker, Settings, Domains and Routes), and make sure the GitHub app's callback uses it.</li>
        <li>
          <p>Run the smoke test:</p>
          <AgentsCodeBlock :code="STEPS.smoke" />
        </li>
      </ol>
      <p>To deploy on every push instead, connect the repository in Workers Builds with <code>CLOUDFLARE_D1_DATABASE_ID</code> as a build variable. Keep its existing <code>pnpm build</code> and <code>npx wrangler deploy</code> commands. That deploy command does not run migrations, so apply new ones with <code>pnpm db:migrate:remote</code>.</p>
    </DocsSection>

    <DocsSection id="env" title="Settings">
      <DocsEnv :extra="[['CLOUDFLARE_D1_DATABASE_ID', 'The id wrangler d1 create printed. Read at build time.'], ['CLOUDFLARE_D1_DATABASE_NAME', 'The D1 database name, vitehub-drop by default.'], ['DROP_CONTENT_ORIGIN', 'Optional. Where apps and HTML docs run, one subdomain per drop on the same Worker, such as https://*-drop.example.com.']]" />
      <p>To <NuxtLink to="/docs/self-host#content-origin">give apps their own domain</NuxtLink>, add a proxied wildcard DNS record to your zone (<code>*</code>, <code>AAAA 100::</code>) and a Worker route <code>*-drop.example.com/*</code>; custom domains don't take wildcards. Then set <code>DROP_CONTENT_ORIGIN</code> to <code>https://*-drop.example.com</code>. The route only matches names that end in <code>-drop</code>, so your other subdomains are untouched, and the free certificate covers them because they're one level deep.</p>
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>D1. <code>pnpm run deploy</code> applies new migrations before it publishes; <code>pnpm db:migrate:remote</code> applies them on their own.</p>
    </DocsSection>

    <DocsSection id="different" title="On Cloudflare">
      <ul>
        <li>Code images come as PNG (the default) or SVG. PNG uses Browser Run.</li>
        <li>Rate limits use Cloudflare's rate limiting binding, namespaced to the Worker's name.</li>
        <li>An hourly Cron Trigger deletes expired code images.</li>
        <li>Workers Logs is on, so every request's log line is searchable in the dashboard.</li>
      </ul>
    </DocsSection>
  </DocsPage>
</template>
