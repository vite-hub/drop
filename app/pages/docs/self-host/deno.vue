<script setup lang="ts">
definePageMeta({ layout: "docs" })

const STEPS = {
  clone: "npx giget gh:vite-hub/drop my-drop\ncd my-drop\npnpm install",
  turso: "turso db create drop\nturso db show drop --url      # TURSO_DATABASE_URL\nturso db tokens create drop   # TURSO_AUTH_TOKEN",
  migrate: "TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… pnpm db:migrate:libsql",
  bucket: "pnpm exec wrangler r2 bucket create drop-files",
  build: "DROP_HOST=deno S3_BUCKET=drop-files S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com pnpm build",
  create: "cd .output\ndeno deploy create --org <your-org> --app my-drop --source local --runtime-mode dynamic --entrypoint server/index.ts",
  env: "deno deploy env add TURSO_DATABASE_URL \"libsql://…\"\ndeno deploy env add TURSO_AUTH_TOKEN \"…\" --secret\ndeno deploy env add AWS_ACCESS_KEY_ID \"…\"\ndeno deploy env add AWS_SECRET_ACCESS_KEY \"…\" --secret\ndeno deploy env add GITHUB_CLIENT_ID \"…\"\ndeno deploy env add GITHUB_CLIENT_SECRET \"…\" --secret\ndeno deploy env add BETTER_AUTH_SECRET \"$(openssl rand -base64 32)\" --secret\ndeno deploy env add DROP_ADMINS \"…\"",
  deploy: "deno deploy --prod",
  smoke: "DROP_URL=https://my-drop.<your-org>.deno.net pnpm test:e2e:deployed",
}
</script>

<template>
  <DocsPage title="Deploy to Deno Deploy" lead="Drop on Deno Deploy, with a Turso database and an S3-compatible bucket for files, like Cloudflare R2 or Amazon S3.">
    <DocsHostFacts host="deno" />

    <DocsSection id="need" title="What you need">
      <ul>
        <li>A <a href="https://console.deno.com">Deno Deploy</a> organization and Deno 2.4 or newer, for <code>deno deploy</code>.</li>
        <li>A <a href="https://turso.tech">Turso</a> account and its CLI (<code>turso auth login</code>). The free plan is enough.</li>
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
          <p>Create the database and a token for it, then apply the migrations:</p>
          <AgentsCodeBlock :code="STEPS.turso" />
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
          <p>Create the app from the build output:</p>
          <AgentsCodeBlock :code="STEPS.create" />
        </li>
        <li>
          <p>Add the settings:</p>
          <AgentsCodeBlock :code="STEPS.env" />
        </li>
        <li>
          <p>Deploy, then run the smoke test:</p>
          <AgentsCodeBlock :code="STEPS.deploy" />
          <AgentsCodeBlock :code="STEPS.smoke" />
        </li>
      </ol>
    </DocsSection>

    <DocsSection id="env" title="Settings">
      <DocsEnv
        :extra="[
          ['TURSO_DATABASE_URL', 'The libsql:// URL of your Turso database.'],
          ['TURSO_AUTH_TOKEN', 'A token for that database.'],
          ['S3_BUCKET, S3_ENDPOINT, S3_REGION', 'The bucket, its endpoint, and its region (auto for R2). Read at build time.'],
          ['AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY', 'The bucket\'s access key.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>Turso, a hosted libSQL database that speaks SQLite. <code>pnpm db:migrate:libsql</code> applies new migrations and skips the ones already applied; run it before you deploy a schema change.</p>
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
