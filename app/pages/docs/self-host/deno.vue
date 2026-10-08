<script setup lang="ts">
definePageMeta({ layout: "docs" })

const bucket = "npx wrangler r2 bucket create my-drop"
</script>

<template>
  <DocsPage title="Deploy to Deno Deploy" lead="Drop on Deno Deploy, with a Cloudflare D1 database and an S3-compatible bucket for files, like Cloudflare R2 or Amazon S3.">
    <DocsDeployButtons host="deno" />

    <DocsSection id="button" title="Deploy with the button">
      <p>The <a href="https://docs.deno.com/deploy/reference/button/">official Deno button</a> clones Drop into your GitHub account and opens the new-app flow. <code>deno.jsonc</code> sets installation, the Deno build, the server entrypoint, and D1 migrations before deployment.</p>
      <ol>
        <li><NuxtLink to="/docs/self-host#database">Create a D1 database and account API token</NuxtLink>.</li>
        <li>
          <p>Create an R2 bucket:</p>
          <AgentsCodeBlock :code="bucket" />
          <p>Under R2, Manage API tokens, create a token with Object Read and Write permission for that bucket. Keep its access key id and secret access key.</p>
        </li>
        <li>Choose an organization and app name. <NuxtLink to="/docs/self-host#github">Create the GitHub OAuth app</NuxtLink> with callback <code>https://&lt;app&gt;.&lt;org&gt;.deno.net/api/auth/callback/github</code>.</li>
        <li>Before deploying, open Edit Environment Variables and add all settings below. Make the D1 settings available to build and runtime; <code>S3_BUCKET</code>, <code>S3_ENDPOINT</code>, and <code>S3_REGION</code> must be available to the build. Put GitHub credentials, the auth secret, admin ids, and S3 access keys in the production runtime context.</li>
      </ol>
      <p>Use a separate D1 database and bucket in preview contexts, or turn previews off. Deno runs pre-deploy migrations for each timeline.</p>
    </DocsSection>

    <DocsHostFacts host="deno" />

    <DocsSection id="env" title="Settings">
      <DocsEnv
        :extra="[
          ['CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN', 'Cloudflare account id and an account API token with D1 edit access.'],
          ['CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME', 'Your D1 database id and name.'],
          ['S3_BUCKET', 'The bucket you created, my-drop in the command above. Read at build time.'],
          ['S3_ENDPOINT', 'https://<account-id>.r2.cloudflarestorage.com for R2. Read at build time.'],
          ['S3_REGION', 'auto for R2. Read at build time.'],
          ['AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY', 'The bucket\'s access key.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>Cloudflare D1 over HTTPS. <code>pnpm db:migrate:d1</code> skips migrations already applied. The GitHub flow runs it as a pre-deploy command. For a local build, run it before publishing.</p>
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
