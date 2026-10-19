---
title: Deploy to Netlify
description: Drop on Netlify Functions, with a Cloudflare D1 database, Netlify Blobs for files, and a scheduled function that deletes expired code images.
---

::docs-deploy-buttons{host="netlify"}
::

## Deploy with the button {#button}

The button clones Drop, creates a site, and prompts for the variables described in `netlify.toml`. Netlify sets the host, builds, applies D1 migrations, and publishes. Netlify Blobs needs no setup.

1. [Create a D1 database and account API token](/docs/self-host#database). Keep the account id, token, database id, and database name ready.
2. Choose a site name and [create the GitHub OAuth app](/docs/self-host#github) with callback `https://<site>.netlify.app/api/auth/callback/github`.
3. Fill the form with those settings, a generated auth secret, and your admin email. If the generated site address differs, update the OAuth callback.

::docs-host-facts{host="netlify"}
::

## Settings {#env}

::docs-env
---
extra:
  - ["CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN", "Cloudflare account id and an account API token with D1 edit access."]
  - ["CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_DATABASE_NAME", "Your D1 database id and name."]
  - ["DROP_HOST", "netlify. Set in netlify.toml."]
---
::

## Database {#database}

Cloudflare D1 over HTTPS. `pnpm db:migrate:d1` skips migrations already applied. The configured Netlify build runs it after building. Disable deploy previews or give them a separate D1 database.

## On Netlify {#different}

- Code images are SVG only: PNG needs Cloudflare Browser Run.
- Rate limits count in memory per function instance, so they're looser than on Cloudflare.
- Files go to a Netlify Blobs store, and Drop serves them at `/f/` after checking access.
- A scheduled function deletes expired code images every hour.
