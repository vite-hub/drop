---
title: Deploy to Deno Deploy
description: Drop on Deno Deploy, with a Cloudflare D1 database and an S3-compatible bucket for files, like Cloudflare R2 or Amazon S3.
---

::docs-deploy-buttons{host="deno"}
::

## Deploy with the button {#button}

The [official Deno button](https://docs.deno.com/deploy/reference/button/) clones Drop into your GitHub account and opens the new-app flow. `deno.jsonc` sets installation, the Deno build, the server entrypoint, and D1 migrations before deployment.

1. [Create a D1 database and account API token](/docs/self-host#database).
2. Create an R2 bucket:

   ```sh
   npx wrangler r2 bucket create my-drop
   ```

   Under R2, Manage API tokens, create a token with Object Read and Write permission for that bucket. Keep its access key id and secret access key.
3. Choose an organization and app name. [Create the GitHub OAuth app](/docs/self-host#github) with callback `https://<app>.<org>.deno.net/api/auth/callback/github`.
4. Before deploying, open Edit Environment Variables and add all settings below. Make the D1 settings available to build and runtime; `S3_BUCKET`, `S3_ENDPOINT`, and `S3_REGION` must be available to the build. Put GitHub credentials, the auth secret, admin emails, and S3 access keys in the production runtime context.

Use a separate D1 database and bucket in preview contexts, or turn previews off. Deno runs pre-deploy migrations for each timeline.

::docs-host-facts{host="deno"}
::

## Settings {#env}

::docs-env
---
extra:
  - ["CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN", "Cloudflare account id and an account API token with D1 edit access."]
  - ["CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME", "Your D1 database id and name."]
  - ["S3_BUCKET", "The bucket you created, my-drop in the command above. Read at build time."]
  - ["S3_ENDPOINT", "https://<account-id>.r2.cloudflarestorage.com for R2. Read at build time."]
  - ["S3_REGION", "auto for R2. Read at build time."]
  - ["AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY", "The bucket's access key."]
---
::

## Database {#database}

Cloudflare D1 over HTTPS. `pnpm db:migrate:d1` skips migrations already applied. The GitHub flow runs it as a pre-deploy command. For a local build, run it before publishing.

## On Deno Deploy {#different}

- Code images are SVG only: PNG needs Cloudflare Browser Run.
- Rate limits count in memory per isolate, so they're looser than on Cloudflare.
- Nothing deletes expired code images: ViteHub has no scheduled jobs on Deno Deploy yet. They stop being served after five minutes, but stay in the bucket; a lifecycle rule on `code-images/` cleans them up.
