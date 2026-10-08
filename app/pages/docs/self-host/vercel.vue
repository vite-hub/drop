<script setup lang="ts">
definePageMeta({ layout: "docs" })

const STEPS = {
  clone: "npx giget gh:vite-hub/drop my-drop\ncd my-drop\npnpm install\nnpx vercel link   # creates the project",
  database: "pnpm exec wrangler d1 create vitehub-drop-vercel   # copy the id into CLOUDFLARE_D1_DATABASE_ID",
  migrate: "CLOUDFLARE_D1_DATABASE_NAME=vitehub-drop-vercel pnpm db:migrate:d1",
  blob: "npx vercel blob create-store drop-files --access private --yes",
  env: "npx vercel env add DROP_HOST production                 # vercel\nnpx vercel env add ENABLE_EXPERIMENTAL_COREPACK production   # 1\nnpx vercel env add CLOUDFLARE_D1_DATABASE_ID production\nnpx vercel env add CLOUDFLARE_D1_DATABASE_NAME production\nnpx vercel env add CLOUDFLARE_API_TOKEN production --sensitive\nnpx vercel env add GITHUB_CLIENT_ID production\nnpx vercel env add GITHUB_CLIENT_SECRET production --sensitive\nnpx vercel env add BETTER_AUTH_SECRET production --sensitive\nnpx vercel env add DROP_ADMINS production",
  deploy: "npx vercel deploy --prod",
  smoke: "DROP_URL=https://<your-domain> pnpm test:e2e:deployed",
}
</script>

<template>
  <DocsPage title="Deploy to Vercel" lead="Drop on Vercel Functions, with a Cloudflare D1 database, a private Vercel Blob store for files, and a Vercel Cron Job that deletes expired code images.">
    <DocsHostFacts host="vercel" />

    <DocsSection id="need" title="What you need">
      <ul>
        <li>A Vercel account and the Vercel CLI (<code>npx vercel login</code>).</li>
        <li>A Cloudflare account and Wrangler (<code>pnpm exec wrangler login</code>).</li>
        <li>Node.js 24 and pnpm.</li>
        <li>A GitHub OAuth app with the callback <code>https://&lt;your-project&gt;.vercel.app/api/auth/callback/github</code>, or your own domain.</li>
      </ul>
    </DocsSection>

    <DocsSection id="steps" title="Deploy">
      <ol>
        <li>
          <p>Get the code and create the Vercel project:</p>
          <AgentsCodeBlock :code="STEPS.clone" />
        </li>
        <li>
          <p>Create the D1 database and copy its id into the environment:</p>
          <AgentsCodeBlock :code="STEPS.database" />
          <p>Apply the migrations:</p>
          <AgentsCodeBlock :code="STEPS.migrate" />
        </li>
        <li>
          <p>Create a private Blob store and connect it to the project. Vercel adds <code>BLOB_READ_WRITE_TOKEN</code> for you:</p>
          <AgentsCodeBlock :code="STEPS.blob" />
        </li>
        <li>
          <p>Add the settings. Each command asks for the value:</p>
          <AgentsCodeBlock :code="STEPS.env" />
        </li>
        <li>
          <p>Deploy. Vercel builds with <code>DROP_HOST=vercel</code>, which writes Vercel's Build Output, the function, and the cron job. Hobby projects accept one cron schedule per day, so the generated cleanup job runs daily there.</p>
          <AgentsCodeBlock :code="STEPS.deploy" />
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
          ['DROP_HOST', 'vercel. Read at build time.'],
          ['ENABLE_EXPERIMENTAL_COREPACK', '1, so Vercel installs with the pnpm version in package.json.'],
          ['CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN', 'Cloudflare account id and an account API token with D1 edit access.'],
          ['CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME', 'The id and name of vitehub-drop-vercel.'],
          ['BLOB_READ_WRITE_TOKEN', 'Added by Vercel when you connect the Blob store.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>Cloudflare D1 over HTTPS. <code>pnpm db:migrate:d1</code> applies new migrations and skips the ones already applied; run it before you deploy a schema change.</p>
    </DocsSection>

    <DocsSection id="different" title="On Vercel">
      <ul>
        <li>Code images are SVG only: PNG needs Cloudflare Browser Run.</li>
        <li>Rate limits count in memory per function instance, so they're looser than on Cloudflare.</li>
        <li>Files go to a private Blob store, and Drop serves them at <code>/f/</code> after checking access.</li>
        <li>A Vercel Cron Job deletes expired code images every hour. On the Hobby plan, Vercel runs it once a day; expired images stop being served either way.</li>
      </ul>
    </DocsSection>
  </DocsPage>
</template>
