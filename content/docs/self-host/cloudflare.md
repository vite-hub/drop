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
3. Accept `pnpm build` as the build command and `pnpm run deploy` as the deploy command. If you add a custom domain later, update the OAuth app's homepage and callback.

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
4. Deploy. It builds, applies the D1 migrations, and publishes the Worker with `.env` as its secrets:

   ```sh
   pnpm build && pnpm run deploy
   ```
5. Add your domain to the Worker (Workers and Pages, your Worker, Settings, Domains and Routes), and make sure the GitHub app's callback uses it.
6. Run the smoke test:

   ```sh
   DROP_URL=https://<your-domain> pnpm test:e2e:deployed
   ```

To deploy on every push instead, connect the repository in Workers Builds with `CLOUDFLARE_D1_DATABASE_ID` as a build variable. Keep its existing `pnpm build` and `npx wrangler deploy` commands. That deploy command does not run migrations, so apply new ones with `pnpm db:migrate:remote`.

## Settings {#env}

::docs-env
---
extra:
  - ["CLOUDFLARE_D1_DATABASE_ID", "The id wrangler d1 create printed. Read at build time."]
  - ["CLOUDFLARE_D1_DATABASE_NAME", "The D1 database name, vitehub-drop by default."]
  - ["DROP_CONTENT_ORIGIN", "Optional. Where apps and HTML docs run, one subdomain per drop on the same Worker, such as https://*-drop.example.com."]
---
::

To [give apps their own domain](/docs/self-host#content-origin), add a proxied wildcard DNS record to your zone (`*`, `AAAA 100::`) and a Worker route `*-drop.example.com/*`; custom domains don't take wildcards. Then set `DROP_CONTENT_ORIGIN` to `https://*-drop.example.com`. The route only matches names that end in `-drop`, so your other subdomains are untouched, and the free certificate covers them because they're one level deep.

## Database {#database}

D1. `pnpm run deploy` applies new migrations before it publishes; `pnpm db:migrate:remote` applies them on their own.

## On Cloudflare {#different}

- Code images come as PNG (the default) or SVG. PNG uses Browser Run.
- Rate limits use Cloudflare's rate limiting binding, namespaced to the Worker's name.
- An hourly Cron Trigger deletes expired code images.
- Workers Logs is on, so every request's log line is searchable in the dashboard.
