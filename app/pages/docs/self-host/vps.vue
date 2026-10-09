<script setup lang="ts">
definePageMeta({ layout: "docs" })

const deploy = "git clone https://github.com/vite-hub/drop my-drop\ncd my-drop\ncp .env.example .env\n${EDITOR:-nano} .env\ndocker compose up -d --build"
const caddy = "drop.example.com {\n  header /f/* Cache-Control \"private, no-store\"\n  reverse_proxy 127.0.0.1:3000\n}"
const update = "git pull\ndocker compose up -d --build"
</script>

<template>
  <DocsPage title="Run it on a VPS" lead="One Node.js process in Docker, with local SQLite and a Docker volume for all persistent data. Put a reverse proxy in front for HTTPS.">
    <DocsDeployButtons host="vps" />

    <DocsHostFacts host="vps" />

    <DocsSection id="need" title="Before you start">
      <p>You need a server with Git, Docker Compose, and a domain pointing at it. SQLite, files, and KV stay on your server.</p>
      <p><NuxtLink to="/docs/self-host#github">Create a GitHub OAuth app</NuxtLink> with callback <code>https://&lt;your-domain&gt;/api/auth/callback/github</code>. Find your admin user id with <code>gh api users/&lt;login&gt; --jq .id</code> and generate <code>BETTER_AUTH_SECRET</code> with <code>openssl rand -base64 32</code>.</p>
    </DocsSection>

    <DocsSection id="steps" title="Run Drop">
      <p>Paste this on the server. Fill the sign-in settings when the editor opens:</p>
      <AgentsCodeBlock :code="deploy" />
      <p>Compose builds for <code>DROP_HOST=vps</code>, applies the existing Drizzle migrations, and starts Drop. It binds port 3000 to localhost and keeps the SQLite database, files, and cleanup history in the <code>drop-data</code> volume. If migrations fail, the server does not start.</p>
    </DocsSection>

    <DocsSection id="proxy" title="Serve HTTPS">
      <p>With <a href="https://caddyserver.com">Caddy</a>, add this to your Caddyfile and reload it:</p>
      <AgentsCodeBlock :code="caddy" />
      <p>Caddy forwards the host and HTTPS scheme. With nginx, set <code>proxy_set_header Host $host</code> and <code>proxy_set_header X-Forwarded-Proto $scheme</code>. Keep the OAuth app's homepage and callback on that HTTPS domain.</p>
    </DocsSection>

    <DocsSection id="env" title="Settings">
      <DocsEnv :extra="[
        ['DROP_DATABASE', 'Optional build override: sqlite or d1. Existing D1 database ids keep the D1 driver.'],
        ['DROP_DATABASE_URL', 'Runtime SQLite file: URL. Defaults to file:.data/database/drop.db. Keep it on the persistent volume.'],
        ['DROP_GITHUB_ORG', 'Optional active organization membership requirement for publishing, viewing, and MCP.'],
        ['DROP_AUTH_PROXY', 'Set 1 to reuse GitHub oauth2-proxy; requires DROP_GITHUB_ORG.'],
        ['DROP_AUTH_PROXY_COOKIE', 'Optional proxy cookie name to clear on logout. Secure, host-only, Path=/.'],
      ]" />
    </DocsSection>

    <DocsSection id="auth-proxy" title="Reuse GitHub oauth2-proxy">
      <p>Set <code>DROP_AUTH_PROXY=1</code> and <code>DROP_GITHUB_ORG=your-org</code>. Native GitHub client credentials are unnecessary in this mode. Configure the existing OAuth app to accept <code>https://&lt;your-domain&gt;/oauth2/callback</code>.</p>
      <p>Configure oauth2-proxy with <code>--provider=github</code>, <code>--scope=user:email read:org</code>, <code>--github-org=your-org</code>, <code>--set-xauthrequest=true</code>, and <code>--pass-access-token=true</code>. Forward <code>X-Auth-Request-Access-Token</code> from its auth response to Drop. Drop checks that token against GitHub, maps its numeric user id, and creates its normal session. Do not forward client-supplied identity headers.</p>
      <p>Use a Secure, host-only proxy cookie with <code>Path=/</code>, such as <code>__Host-drop-auth</code>, and set <code>DROP_AUTH_PROXY_COOKIE</code> to the same name for logout. Keep the Drop backend accessible only through your proxy.</p>
      <p>Browser pages and shared links can require proxy authentication. Exempt <code>/oauth2</code>, <code>/.well-known</code>, <code>/mcp</code>, <code>/api/mcp</code>, and Drop's <code>/api/auth/oauth2</code> and <code>/api/auth/jwks</code> routes from the proxy's browser redirect. MCP clients authenticate with Drop's own OAuth tokens; Drop checks organization membership for their content access too.</p>
      <p>Successful membership checks expire after five minutes. Failed checks deny access. A token without <code>read:org</code> or organization access may require reauthorization.</p>
    </DocsSection>

    <DocsSection id="d1" title="Keep an existing D1 database">
      <p>Keep the four Cloudflare settings from your existing deployment and optionally set <code>DROP_DATABASE=d1</code>. Compose passes the database selection to the build and runs D1 migrations at startup. Changing to SQLite needs a rebuild and a separate data migration.</p>
    </DocsSection>

    <DocsSection id="data" title="Updates and backups">
      <AgentsCodeBlock :code="update" />
      <p>Migrations run on every container start and skip those already applied. Stop Drop before backing up the Docker volume, or use SQLite's backup API and also back up the blobs. Rebuilding preserves the volume; <code>docker compose down -v</code> deletes it.</p>
      <p>Run one instance. Rate limits count in its memory. Code images are SVG, and an hourly timer deletes expired images.</p>
    </DocsSection>
  </DocsPage>
</template>
