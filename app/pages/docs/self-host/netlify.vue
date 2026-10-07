<script setup lang="ts">
definePageMeta({ layout: "docs" })

const STEPS = {
  clone: "npx giget gh:vite-hub/drop my-drop\ncd my-drop\npnpm install\nnpx netlify login\nnpx netlify sites:create --name my-drop",
  turso: "turso db create drop\nturso db show drop --url      # TURSO_DATABASE_URL\nturso db tokens create drop   # TURSO_AUTH_TOKEN",
  migrate: "TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… pnpm db:migrate:libsql",
  env: "npx netlify env:set TURSO_DATABASE_URL libsql://…\nnpx netlify env:set TURSO_AUTH_TOKEN … --secret\nnpx netlify env:set GITHUB_CLIENT_ID …\nnpx netlify env:set GITHUB_CLIENT_SECRET … --secret\nnpx netlify env:set BETTER_AUTH_SECRET \"$(openssl rand -base64 32)\" --secret\nnpx netlify env:set DROP_ADMINS …",
  deploy: "npx netlify deploy --build --prod",
  smoke: "DROP_URL=https://my-drop.netlify.app pnpm test:e2e:deployed",
}
</script>

<template>
  <DocsPage title="Deploy to Netlify" lead="Drop on Netlify Functions, with a Turso database, Netlify Blobs for files, and a scheduled function that deletes expired code images.">
    <DocsHostFacts host="netlify" />

    <DocsSection id="need" title="What you need">
      <ul>
        <li>A Netlify account.</li>
        <li>A <a href="https://turso.tech">Turso</a> account and its CLI (<code>turso auth login</code>). The free plan is enough.</li>
        <li>Node.js 24 and pnpm.</li>
        <li>A GitHub OAuth app with the callback <code>https://&lt;your-site&gt;.netlify.app/api/auth/callback/github</code>, or your own domain.</li>
      </ul>
    </DocsSection>

    <DocsSection id="steps" title="Deploy">
      <ol>
        <li>
          <p>Get the code and create the site:</p>
          <AgentsCodeBlock :code="STEPS.clone" />
          <p><code>netlify.toml</code> already sets <code>DROP_HOST=netlify</code>, Node.js 24, and the build command.</p>
        </li>
        <li>
          <p>Create the database and a token for it:</p>
          <AgentsCodeBlock :code="STEPS.turso" />
          <p>Apply the migrations:</p>
          <AgentsCodeBlock :code="STEPS.migrate" />
        </li>
        <li>
          <p>Add the settings:</p>
          <AgentsCodeBlock :code="STEPS.env" />
          <p>Netlify Blobs needs no setup: the functions get their credentials from Netlify.</p>
        </li>
        <li>
          <p>Build and deploy:</p>
          <AgentsCodeBlock :code="STEPS.deploy" />
          <p>To deploy on every push instead, link the repository in the Netlify dashboard. It builds with the same <code>netlify.toml</code>.</p>
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
          ['TURSO_DATABASE_URL', 'The libsql:// URL of your Turso database.'],
          ['TURSO_AUTH_TOKEN', 'A token for that database.'],
          ['DROP_HOST', 'netlify. Set in netlify.toml.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>Turso, a hosted libSQL database that speaks SQLite. <code>pnpm db:migrate:libsql</code> applies new migrations and skips the ones already applied; run it before you deploy a schema change.</p>
    </DocsSection>

    <DocsSection id="different" title="On Netlify">
      <ul>
        <li>Code images are SVG only: PNG needs Cloudflare Browser Run.</li>
        <li>Rate limits count in memory per function instance, so they're looser than on Cloudflare.</li>
        <li>Files go to a Netlify Blobs store, and Drop serves them at <code>/f/</code> after checking access.</li>
        <li>A scheduled function deletes expired code images every hour.</li>
      </ul>
    </DocsSection>
  </DocsPage>
</template>
