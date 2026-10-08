<script setup lang="ts">
definePageMeta({ layout: "docs" })
</script>

<template>
  <DocsPage title="Deploy to Vercel" lead="Drop on Vercel Functions, with a Cloudflare D1 database, a private Vercel Blob store for files, and a Vercel Cron Job that deletes expired code images.">
    <DocsDeployButtons host="vercel" />

    <DocsSection id="button" title="Deploy with the button">
      <p>The button clones the repository, creates a Vercel project, prompts for its settings, and opens the Blob store setup. <code>vercel.json</code> selects <code>DROP_HOST=vercel</code>, installs with the pinned pnpm version, builds, and applies D1 migrations before publishing.</p>
      <ol>
        <li><NuxtLink to="/docs/self-host#database">Create a D1 database and account API token</NuxtLink>. You need the account id, token, database id, and database name.</li>
        <li>At the Storage step, choose or create a <strong>private</strong> Blob store. Vercel connects it and supplies <code>BLOB_READ_WRITE_TOKEN</code>. The <code>stores</code> parameter requests Blob, but does not select its access mode.</li>
        <li>Choose your project name, then <NuxtLink to="/docs/self-host#github">create the GitHub OAuth app</NuxtLink> with <code>https://&lt;project&gt;.vercel.app/api/auth/callback/github</code>. Supply its credentials, a generated auth secret, and your GitHub user id.</li>
        <li>If the flow offers only a public store, create a private one in the dashboard under Storage, connect it to the project, and redeploy. Drop requires private Blob access. If you change the domain, update the OAuth callback.</li>
      </ol>
    </DocsSection>

    <DocsHostFacts host="vercel" />

    <DocsSection id="env" title="Settings">
      <DocsEnv
        :extra="[
          ['DROP_HOST', 'vercel. Read at build time.'],
          ['CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN', 'Cloudflare account id and an account API token with D1 edit access.'],
          ['CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME', 'Your D1 database id and name.'],
          ['BLOB_READ_WRITE_TOKEN', 'Added by Vercel when you connect the Blob store.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>Cloudflare D1 over HTTPS. <code>pnpm db:migrate:d1</code> skips migrations already applied. The configured Vercel build runs it after building. Disable previews or give them a separate D1 database.</p>
    </DocsSection>

    <DocsSection id="different" title="On Vercel">
      <ul>
        <li>Code images are SVG only: PNG needs Cloudflare Browser Run.</li>
        <li>Rate limits count in memory per function instance, so they're looser than on Cloudflare.</li>
        <li>Files go to a private Blob store, and Drop serves them at <code>/f/</code> after checking access.</li>
        <li>A Vercel Cron Job deletes expired code images once a day, which works on the Hobby plan. Expired images stop being served immediately.</li>
      </ul>
    </DocsSection>
  </DocsPage>
</template>
