<script setup lang="ts">
definePageMeta({ layout: "docs" })

const STEPS = {
  clone: "git clone https://github.com/vite-hub/drop /srv/drop\ncd /srv/drop\npnpm install",
  build: "DROP_HOST=vps pnpm build\nCLOUDFLARE_D1_DATABASE_NAME=vitehub-drop-vps pnpm db:migrate:d1",
  env: "GITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\nBETTER_AUTH_SECRET=\nDROP_ADMINS=\nCLOUDFLARE_ACCOUNT_ID=\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_D1_DATABASE_ID=\nCLOUDFLARE_D1_DATABASE_NAME=vitehub-drop-vps\nHOST=127.0.0.1\nPORT=3000",
  run: "node --env-file=.env .output/server/index.mjs",
  unit: "[Unit]\nDescription=Drop\nAfter=network.target\n\n[Service]\nUser=drop\nWorkingDirectory=/srv/drop\nEnvironmentFile=/srv/drop/.env\nExecStart=/usr/bin/node .output/server/index.mjs\nRestart=always\n\n[Install]\nWantedBy=multi-user.target",
  enable: "sudo systemctl enable --now drop",
  caddy: "drop.example.com {\n  reverse_proxy 127.0.0.1:3000\n}",
  smoke: "DROP_URL=https://drop.example.com pnpm test:e2e:deployed",
  update: "git pull\npnpm install\nDROP_HOST=vps pnpm build\npnpm db:migrate:d1\nsudo systemctl restart drop",
  backup: "rsync -a .data/blob/ /backups/blob/",
}
</script>

<template>
  <DocsPage title="Run it on a VPS" lead="Drop as one Node.js process on a server of yours: D1 over HTTP for the database, the disk for files, and a reverse proxy in front for HTTPS.">
    <DocsHostFacts host="vps" />

    <DocsSection id="need" title="What you need">
      <ul>
        <li>A Linux server with Node.js 24 and pnpm.</li>
        <li>A domain pointing at the server, and a reverse proxy that serves HTTPS. These steps use <a href="https://caddyserver.com">Caddy</a>, which gets the certificate for you.</li>
        <li>A GitHub OAuth app with the callback <code>https://&lt;your-domain&gt;/api/auth/callback/github</code>.</li>
      </ul>
    </DocsSection>

    <DocsSection id="steps" title="Deploy">
      <ol>
        <li>
          <p>On the server, get the code:</p>
          <AgentsCodeBlock :code="STEPS.clone" />
        </li>
        <li>
          <p>Build for Node and create the database:</p>
          <AgentsCodeBlock :code="STEPS.build" />
        </li>
        <li>
          <p>Write <code>/srv/drop/.env</code> with the settings below. Keep the server on <code>127.0.0.1</code>; Caddy is the only thing that talks to it.</p>
          <AgentsCodeBlock :code="STEPS.env" />
          <p>Try it with:</p>
          <AgentsCodeBlock :code="STEPS.run" />
        </li>
        <li>
          <p>Keep it running with systemd, in <code>/etc/systemd/system/drop.service</code>:</p>
          <AgentsCodeBlock :code="STEPS.unit" />
          <AgentsCodeBlock :code="STEPS.enable" />
        </li>
        <li>
          <p>Put Caddy in front, in <code>/etc/caddy/Caddyfile</code>, and reload it:</p>
          <AgentsCodeBlock :code="STEPS.caddy" />
          <p>Caddy sends <code>X-Forwarded-Proto: https</code>, so the links Drop builds, the GitHub callback, and the OAuth issuer all use <code>https://</code>. With nginx, set <code>proxy_set_header Host $host</code> and <code>proxy_set_header X-Forwarded-Proto $scheme</code>.</p>
        </li>
        <li>
          <p>Run the smoke test:</p>
          <AgentsCodeBlock :code="STEPS.smoke" />
        </li>
      </ol>
    </DocsSection>

    <DocsSection id="env" title="Settings">
      <DocsEnv
        :extra="[
          ['HOST, PORT', 'Where Node listens. 127.0.0.1 and 3000 behind Caddy.'],
          ['CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN', 'Cloudflare account id and an account API token with D1 edit access.'],
          ['CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME', 'The id and name of vitehub-drop-vps.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="data" title="Database and files">
      <p>Files and the cleanup job's run history live in <code>.data/</code>, next to the code. The database is D1 over HTTPS. Paths are relative to the working directory, so start Drop from <code>/srv/drop</code> as the unit does. Back up the database and the files:</p>
      <AgentsCodeBlock :code="STEPS.backup" />
      <p>To update, pull, rebuild, migrate, and restart. <code>pnpm db:migrate:d1</code> skips the migrations already applied.</p>
      <AgentsCodeBlock :code="STEPS.update" />
    </DocsSection>

    <DocsSection id="different" title="On a VPS">
      <ul>
        <li>One process holds everything, so run one instance. Rate limits are counted in its memory and reset when it restarts.</li>
        <li>Code images are SVG only: PNG needs Cloudflare Browser Run.</li>
        <li>The hourly cleanup of expired code images runs on a timer inside the process.</li>
        <li>The Node process calls D1 over HTTPS, so keep the account id, API token, database id, and database name in its environment.</li>
      </ul>
    </DocsSection>
  </DocsPage>
</template>
