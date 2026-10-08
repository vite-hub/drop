<script setup lang="ts">
definePageMeta({ layout: "docs" })
</script>

<template>
  <DocsPage title="Deploy to Netlify" lead="Drop on Netlify Functions, with a Cloudflare D1 database, Netlify Blobs for files, and a scheduled function that deletes expired code images.">
    <DocsDeployButtons host="netlify" />

    <DocsSection id="button" title="Deploy with the button">
      <p>The button clones Drop, creates a site, and prompts for the variables described in <code>netlify.toml</code>. Netlify sets the host, builds, applies D1 migrations, and publishes. Netlify Blobs needs no setup.</p>
      <ol>
        <li><NuxtLink to="/docs/self-host#database">Create a D1 database and account API token</NuxtLink>. Keep the account id, token, database id, and database name ready.</li>
        <li>Choose a site name and <NuxtLink to="/docs/self-host#github">create the GitHub OAuth app</NuxtLink> with callback <code>https://&lt;site&gt;.netlify.app/api/auth/callback/github</code>.</li>
        <li>Fill the form with those settings, a generated auth secret, and your GitHub user id. If the generated site address differs, update the OAuth callback.</li>
      </ol>
    </DocsSection>

    <DocsHostFacts host="netlify" />

    <DocsSection id="env" title="Settings">
      <DocsEnv
        :extra="[
          ['CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN', 'Cloudflare account id and an account API token with D1 edit access.'],
          ['CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME', 'Your D1 database id and name.'],
          ['DROP_HOST', 'netlify. Set in netlify.toml.'],
        ]"
      />
    </DocsSection>

    <DocsSection id="database" title="Database">
      <p>Cloudflare D1 over HTTPS. <code>pnpm db:migrate:d1</code> skips migrations already applied. The configured Netlify build runs it after building. Disable deploy previews or give them a separate D1 database.</p>
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
