<script setup lang="ts">
definePageMeta({ layout: "docs" })

const deploy = "git clone https://github.com/vite-hub/drop my-drop\ncd my-drop\ncp .env.example .env\n${EDITOR:-nano} .env\ndocker compose up -d --build"
const database = "npx wrangler login\nnpx wrangler d1 create my-drop"
const caddy = "drop.example.com {\n  header /f/* Cache-Control \"private, no-store\"\n  reverse_proxy 127.0.0.1:3000\n}"
const update = "git pull\ndocker compose up -d --build"
</script>

<template>
  <DocsPage title="Run it on a VPS" lead="One Node.js process in Docker, with D1 over HTTP for the database and a Docker volume for files. Put a reverse proxy in front for HTTPS.">
    <DocsDeployButtons host="vps" />

    <DocsHostFacts host="vps" />

    <DocsSection id="need" title="Before you start">
      <p>You need a server with Git, Docker Compose, and a domain pointing at it. Drop still uses Cloudflare D1 for its database.</p>
      <p>From a machine with Node.js, create a D1 database, then <NuxtLink to="/docs/self-host#database">create an account API token with D1 edit permission</NuxtLink>:</p>
      <AgentsCodeBlock :code="database" />
      <p><NuxtLink to="/docs/self-host#github">Create a GitHub OAuth app</NuxtLink> with callback <code>https://&lt;your-domain&gt;/api/auth/callback/github</code>. Find your admin user id with <code>gh api users/&lt;login&gt; --jq .id</code> and generate <code>BETTER_AUTH_SECRET</code> with <code>openssl rand -base64 32</code>.</p>
    </DocsSection>

    <DocsSection id="steps" title="Run Drop">
      <p>Paste this on the server. Fill the sign-in settings and uncomment the four Cloudflare settings when the editor opens. Supply the D1 database id and name, account id, and API token:</p>
      <AgentsCodeBlock :code="deploy" />
      <p>Compose builds for <code>DROP_HOST=vps</code>, applies D1 migrations, and starts Drop. It binds port 3000 to localhost and keeps files and cleanup history in the <code>drop-data</code> volume. If migrations fail, the server does not start.</p>
    </DocsSection>

    <DocsSection id="proxy" title="Serve HTTPS">
      <p>With <a href="https://caddyserver.com">Caddy</a>, add this to your Caddyfile and reload it:</p>
      <AgentsCodeBlock :code="caddy" />
      <p>Caddy forwards the host and HTTPS scheme. With nginx, set <code>proxy_set_header Host $host</code> and <code>proxy_set_header X-Forwarded-Proto $scheme</code>. Keep the OAuth app's homepage and callback on that HTTPS domain.</p>
    </DocsSection>

    <DocsSection id="env" title="Settings">
      <DocsEnv :extra="[
        ['CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN', 'Your account id and account API token with D1 edit permission.'],
        ['CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME', 'Your D1 database id and name. The id is also passed to the Docker build.'],
      ]" />
    </DocsSection>

    <DocsSection id="data" title="Updates and backups">
      <AgentsCodeBlock :code="update" />
      <p>Migrations run on every container start and skip those already applied. Back up the Docker volume. From a machine with Node.js, export D1 with <code>npx wrangler d1 export &lt;database-name&gt; --remote --output backup.sql</code>. Rebuilding preserves the volume; <code>docker compose down -v</code> deletes it.</p>
      <p>Run one instance. Rate limits count in its memory. Code images are SVG, and an hourly timer deletes expired images.</p>
    </DocsSection>
  </DocsPage>
</template>
