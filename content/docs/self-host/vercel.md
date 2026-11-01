---
title: Deploy to Vercel
description: Drop on Vercel Functions, with a Cloudflare D1 database, a private Vercel Blob store for files, and a Vercel Cron Job that deletes expired code images.
---

::docs-deploy-buttons{host="vercel"}
::

## Deploy with the button {#button}

The button clones the repository, creates a Vercel project, prompts for its settings, and opens the Blob store setup. `vercel.json` selects `DROP_HOST=vercel`, installs with the pinned pnpm version, builds, and applies D1 migrations before publishing.

1. [Create a D1 database and account API token](/docs/self-host#database). You need the account id, token, database id, and database name.
2. At the Storage step, choose or create a **private** Blob store. Vercel connects it and supplies `BLOB_READ_WRITE_TOKEN`. The `stores` parameter requests Blob, but does not select its access mode.
3. Choose your project name, then [create the GitHub OAuth app](/docs/self-host#github) with `https://<project>.vercel.app/api/auth/callback/github`. Supply its credentials, a generated auth secret, and your admin email.
4. If the flow offers only a public store, create a private one in the dashboard under Storage, connect it to the project, and redeploy. Drop requires private Blob access. If you change the domain, update the OAuth callback.

::docs-host-facts{host="vercel"}
::

## Settings {#env}

::docs-env
---
extra:
  - ["DROP_HOST", "vercel. Read at build time."]
  - ["CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN", "Cloudflare account id and an account API token with D1 edit access."]
  - ["CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME", "Your D1 database id and name."]
  - ["BLOB_READ_WRITE_TOKEN", "Added by Vercel when you connect the Blob store."]
---
::

## Database {#database}

Cloudflare D1 over HTTPS. `pnpm db:migrate --allow-data-loss` skips migrations already applied and permits Drop's intentional schema removals. The configured Vercel build runs it after building. Disable previews or give them a separate D1 database.

## On Vercel {#different}

- Code images are SVG only: PNG needs Cloudflare Browser Run.
- Rate limits count in memory per function instance, so they're looser than on Cloudflare.
- Files go to a private Blob store, and Drop serves them at `/f/` after checking access.
- A Vercel Cron Job deletes expired code images once a day, which works on the Hobby plan. Expired images stop being served immediately.
