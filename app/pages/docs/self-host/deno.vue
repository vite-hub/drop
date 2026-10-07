<script setup lang="ts">
definePageMeta({ layout: "docs" })

const STEPS = {
  clone: "npx giget gh:vite-hub/drop my-drop\ncd my-drop\npnpm install",
  database: "pnpm exec wrangler d1 create vitehub-drop-deno   # copy the id into CLOUDFLARE_D1_DATABASE_ID",
  migrate: "CLOUDFLARE_D1_DATABASE_NAME=vitehub-drop-deno pnpm db:migrate:d1",
  bucket: "pnpm exec wrangler r2 bucket create drop-files",
  build: "DROP_HOST=deno S3_BUCKET=drop-files S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com pnpm build",
  deploy: "DENO_DEPLOY_ORG=<your-org> DENO_DEPLOY_APP=my-drop node .output/deploy.mjs",
  env: "deno deploy env add --org <your-org> --app my-drop CLOUDFLARE_ACCOUNT_ID \"…\"\ndeno deploy env add --org <your-org> --app my-drop CLOUDFLARE_API_TOKEN \"…\" --secret\ndeno deploy env add --org <your-org> --app my-drop CLOUDFLARE_D1_DATABASE_ID \"…\"\ndeno deploy env add --org <your-org> --app my-drop CLOUDFLARE_D1_DATABASE_NAME \"vitehub-drop-deno\"\ndeno deploy env add --org <your-org> --app my-drop AWS_ACCESS_KEY_ID \"…\"\ndeno deploy env add --org <your-org> --app my-drop AWS_SECRET_ACCESS_KEY \"…\" --secret\ndeno deploy env add --org <your-org> --app my-drop GITHUB_CLIENT_ID \"…\"\ndeno deploy env add --org <your-org> --app my-drop GITHUB_CLIENT_SECRET \"…\" --secret\ndeno deploy env add --org <your-org> --app my-drop BETTER_AUTH_SECRET \"$(openssl rand -base64 32)\" --secret\ndeno deploy env add --org <your-org> --app my-drop DROP_ADMINS \"…\"",
  smoke: "DROP_URL=https://my-drop.<your-org>.deno.net pnpm test:e2e:deployed",
}
</script>

<template>
  <DocsPage title="Deploy to Deno Deploy" lead="Drop on Deno Deploy, with a Cloudflare D1 database and an S3-compatible bucket for files, like Cloudflare R2 or Amazon S3.">
    <DocsHostFacts host="deno" />

    <DocsSection id="need" title="What you need">
      <ul>
        <li>A <a href="https://console.deno.com">Deno Deploy</a> organization, and Deno 2.4 or newer signed in to it, for <code>deno deploy</code>.</li>
        <li>A Cloudflare account and Wrangler (<code>pnpm exec wrangler login</code>).</li>
        <li>An S3-compatible bucket and an access key for it. Deno Deploy has no file storage of its own.</li>
        <li>Node.js 24 and pnpm, to build.</li>
        <li>A GitHub OAuth app with the callback <code>https://&lt;your-app-domain&gt;/api/auth/callback/github</code>.</li>
      </ul>
    </DocsSection>

    <DocsSection id="steps" title="Deploy">
      <ol>
        <li>
          <p>Get the code:</p>
          <AgentsCodeBlock :code="STEPS.clone" />
        </li>
        <li>
          <p>Create the D1 database and apply its migrations:</p>
          <AgentsCodeBlock :code="STEPS.database" />
          <AgentsCodeBlock :code="STEPS.migrate" />
        </li>
        <li>
          <p>Create a bucket. With Cloudflare R2:</p>
          <AgentsCodeBlock :code="STEPS.bucket" />
          <p>Then create an R2 API token with Object Read and Write on that bucket, under R2, Manage API tokens. It gives you an access key id and a secret.</p>
        </li>
        <li>
          <p>Build for Deno. The bucket's name and endpoint are read at build time:</p>
          <AgentsCodeBlock :code="STEPS.build" />
        </li>
        <li>
          <p>Deploy. ViteHub writes <code>.output/deploy.mjs</code>, which creates the app on the first run (entrypoint <code>server/index.mjs</code>, with the traced <code>node_modules</code>) and deploys it to production:</p>
          <AgentsCodeBlock :code="STEPS.deploy" />
        </li>
        <li>
          <p>Add the settings, then deploy again so the app picks them up:</p>
          <AgentsCodeBlock :code="STEPS.env" />
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
          ['CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME', 'The id and name of vitehub-drop-deno.'],
          ['CLOUDFLARE_API_TOKEN', 'Cloudflare account API token with D1 edit access.'],
          ['S3_BUCKET, S3_ENDPOINT, S3_REGION', 'The bucket, its endpoint, and its region (auto for R2). Read at build time.'],
          ['AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY', 'The bucket\'s access key.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>Cloudflare D1 over HTTPS. <code>pnpm db:migrate:d1</code> applies new migrations and skips the ones already applied; run it before you deploy a schema change.</p>
    </DocsSection>

    <DocsSection id="different" title="On Deno Deploy">
      <ul>
        <li>Code images are SVG only: PNG needs Cloudflare Browser Run.</li>
        <li>Rate limits count in memory per isolate, so they're looser than on Cloudflare.</li>
        <li>Nothing deletes expired code images: ViteHub has no scheduled jobs on Deno Deploy yet. They stop being served after five minutes, but stay in the bucket; a lifecycle rule on <code>code-images/</code> cleans them up.</li>
      </ul>
    </DocsSection>
  </DocsPage>
</template>
