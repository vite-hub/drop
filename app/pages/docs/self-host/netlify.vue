<script setup lang="ts">
definePageMeta({ layout: "docs" })

const STEPS = {
  clone: "npx giget gh:vite-hub/drop my-drop\ncd my-drop\npnpm install\nnpx netlify login\nnpx netlify sites:create --name my-drop",
  database: "pnpm exec wrangler d1 create vitehub-drop-netlify   # copy the id into CLOUDFLARE_D1_DATABASE_ID",
  migrate: "CLOUDFLARE_D1_DATABASE_NAME=vitehub-drop-netlify pnpm db:migrate:d1",
  env: "npx netlify env:set CLOUDFLARE_ACCOUNT_ID …\nnpx netlify env:set CLOUDFLARE_API_TOKEN … --secret\nnpx netlify env:set CLOUDFLARE_D1_DATABASE_ID …\nnpx netlify env:set CLOUDFLARE_D1_DATABASE_NAME vitehub-drop-netlify\nnpx netlify env:set GITHUB_CLIENT_ID …\nnpx netlify env:set GITHUB_CLIENT_SECRET … --secret\nnpx netlify env:set BETTER_AUTH_SECRET \"$(openssl rand -base64 32)\" --secret\nnpx netlify env:set DROP_ADMINS …",
  deploy: "npx netlify deploy --build --prod",
  smoke: "DROP_URL=https://my-drop.netlify.app pnpm test:e2e:deployed",
}
</script>

<template>
  <DocsPage title="Deploy to Netlify" lead="Drop on Netlify Functions, with a Cloudflare D1 database, Netlify Blobs for files, and a scheduled function that deletes expired code images.">
    <DocsHostFacts host="netlify" />

    <DocsSection id="need" title="What you need">
      <ul>
        <li>A Netlify account.</li>
        <li>A Cloudflare account and Wrangler (<code>pnpm exec wrangler login</code>).</li>
        <li>Node.js 24 and pnpm.</li>
        <li>A GitHub OAuth app with the callback <code>https://&lt;your-site&gt;.netlify.app/api/auth/callback/github</code>, or your own domain.</li>
      </ul>
    </DocsSection>

    <DocsSection id="steps" title="Deploy">
      <ol>
        <li>
          <p>Get the code and create the site:</p>
          <AgentsCodeBlock :code="STEPS.clone" />
          <p><code>netlify.toml</code> already sets <code>DROP_HOST=netlify</code>, Node.js 24, and the build command. The build keeps Nitro's tracked function wrapper and copies the native runtime that Netlify's bundler needs.</p>
        </li>
        <li>
          <p>Create the D1 database and copy its id into the environment:</p>
          <AgentsCodeBlock :code="STEPS.database" />
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
          ['CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN', 'Cloudflare account id and an account API token with D1 edit access.'],
          ['CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME', 'The id and name of vitehub-drop-netlify.'],
          ['DROP_HOST', 'netlify. Set in netlify.toml.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>Cloudflare D1 over HTTPS. <code>pnpm db:migrate:d1</code> applies new migrations and skips the ones already applied; run it before you deploy a schema change.</p>
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
