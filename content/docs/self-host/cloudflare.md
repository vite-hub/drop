---
title: Deploy to Cloudflare
description: Drop's default host. One Worker with D1, R2, KV, rate limiting, Browser Run, and a Cron Trigger, all in your Cloudflare account.
---

::docs-deploy-buttons{host="cloudflare"}
::

## Deploy with the button {#button}

The button clones Drop into your GitHub account, creates D1, R2, and KV, and asks for the four sign-in settings below. It builds, applies migrations, and deploys the Worker. Enable R2 and Browser Run in your Cloudflare account first; they may require billing.

1. Choose a Worker name and note its `https://<worker>.<subdomain>.workers.dev` address.
2. [Create a GitHub OAuth app](/docs/self-host#github) with that address and callback `<origin>/api/auth/callback/github`. Supply its client id and secret, `BETTER_AUTH_SECRET` from `openssl rand -base64 32`, and `DROP_ADMINS` with the admins' emails.
3. Accept `pnpm build` as the build command and `pnpm run deploy` as the deploy command. This setup needs a build API token with D1 Write as well as deploy permissions; see [Workers Builds](#workers-builds). If you add a custom domain later, update the OAuth app's homepage and callback.

The root `wrangler.jsonc` describes resources for the button. Cloudflare writes their new ids there. ViteHub generates `.output/server/wrangler.json` during the build; Drop carries the template's resource names and ids into that file. `CLOUDFLARE_D1_DATABASE_ID` still takes priority, so existing Workers Builds keep their current database.

::docs-host-facts{host="cloudflare"}
::

## What you need {#need}

- A Cloudflare account.
- Node.js 24 and pnpm.
- A GitHub OAuth app with the callback `https://<your-domain>/api/auth/callback/github`. Use your `workers.dev` address until you add a domain.

## Deploy from the terminal {#steps}

1. Get the code and sign in to Cloudflare:

   ```sh
   npx giget gh:vite-hub/drop my-drop
   cd my-drop
   pnpm install
   pnpm exec wrangler login
   ```
2. Create the database and the bucket. Copy the database id into `CLOUDFLARE_D1_DATABASE_ID` in the next step.

   ```sh
   pnpm exec wrangler d1 create vitehub-drop   # prints the database id
   pnpm exec wrangler r2 bucket create vitehub-drop
   ```

   The KV namespace for Drop's render cache has no id to fill in. Wrangler creates it on the first deploy.
3. Fill `.env` with the settings below. Uncomment the D1 database id and name:

   ```sh
   cp .env.example .env
   ```
4. Deploy. With a `.env`, `pnpm run deploy` builds, applies the D1 migrations, and publishes the Worker. It uploads only nonempty runtime values allowed by the generated deployment manifest. `CLOUDFLARE_API_TOKEN` is used by Wrangler and is not uploaded, even if a previous deploy left a secret with that name on the Worker. Unspecified Worker secrets are left unchanged. Console is optional:

   ```sh
   pnpm run deploy
   ```
5. Add your domain to the Worker (Workers and Pages, your Worker, Settings, Domains and Routes), and make sure the GitHub app's callback uses it.
6. Run the smoke test:

   ```sh
   DROP_URL=https://<your-domain> pnpm test:e2e:deployed
   ```

## Deploy on every push with Workers Builds {#workers-builds}

Set the build command to `pnpm build`. Build-time migrations are opt-in: in the Worker's **Settings → Build**, set `DROP_PRODUCTION_BRANCH` only in the **Production** build settings to the exact configured production branch, even if it is `main`. Leave it unset in **Preview** so that preview builds never migrate, even when building `main`.

On an opted-in branch, the build applies migrations to the `DB` binding in `.output/server/wrangler.json` before the deploy command runs. The database ID can come from `CLOUDFLARE_D1_DATABASE_ID` or from the provisioned `wrangler.jsonc` used by the Deploy button. The migration needs **D1 Write** on the account that owns `DB`. The default Workers Builds deploy token does not grant that permission. Use one of these setups:

- With the default production deploy command (`npx wrangler deploy`), opt in as described above and set `CLOUDFLARE_ACCOUNT_ID` in the Production build settings if it isn't already available. Add an account-scoped D1 Write token as the `DROP_D1_MIGRATION_TOKEN` **build secret**, or use a Workers Builds API token that already has D1 Write. The separate secret does not replace the deploy token.
- If you use `pnpm run deploy` as the production deploy command, leave `DROP_PRODUCTION_BRANCH` unset: the deploy command applies migrations itself. Select a Workers Builds API token with both deploy permissions and D1 Write. A separate migration secret alone won't grant the deploy command D1 access.

Verify the build and deploy on a separate Worker backed by a test D1 database before enabling this setup on production. A missing binding or a migration failure stops the build before deployment. Use migrations that are compatible with the currently deployed Worker: the schema changes before the new Worker is published.

## Settings {#env}

::docs-env
---
extra:
  - ["CLOUDFLARE_D1_DATABASE_ID", "The id wrangler d1 create printed. Read at build time."]
  - ["DROP_PRODUCTION_BRANCH", "Optional build-time opt-in for D1 migrations. Set only in Workers Builds Production settings to the exact production branch; no default."]
  - ["CLOUDFLARE_D1_DATABASE_NAME", "The D1 database name, vitehub-drop by default."]
  - ["DROP_CONTENT_ORIGIN", "Optional. Where apps and HTML docs run, one subdomain per drop on the same Worker, such as https://*-drop.example.com. Needs VITEHUB_SECRET."]
---
::

To [give apps their own domain](/docs/self-host#content-origin), add a proxied wildcard DNS record to your zone (`*`, `AAAA 100::`) and a Worker route `*-drop.example.com/*`; custom domains don't take wildcards. Then set `DROP_CONTENT_ORIGIN` to `https://*-drop.example.com`, and `VITEHUB_SECRET` to the output of `openssl rand -base64 32`. The route only matches names that end in `-drop`, so your other subdomains are untouched, and the free certificate covers them because they're one level deep.

## Database {#database}

D1. `pnpm run deploy` applies new migrations before it publishes. Without a local `.env`, as in Workers Builds, it runs the deploy command of the last `pnpm build` and keeps the Worker's secrets as they are.

After deploying a database change, confirm the new migration appears in the remote `d1_migrations` ledger, then exercise a lookup that uses the changed schema on the deployed Worker. The pull request migration check cannot verify either step.

To update, [pull Drop's changes into your repository](/docs/self-host#update) and push.

## On Cloudflare {#different}

- Code images come as PNG (the default) or SVG. PNG uses Browser Run.
- Rate limits use Cloudflare's rate limiting binding, namespaced to the Worker's name.
- An hourly Cron Trigger deletes expired code images.
- Workers Logs is on, so every request's log line is searchable in the dashboard.
