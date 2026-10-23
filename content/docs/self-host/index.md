---
title: Host it yourself
description: Run your own Drop on Cloudflare, Vercel, Netlify, Deno Deploy, or a VPS.
---

::docs-deploy-buttons
::

Start with the button for your host. You still supply GitHub sign-in and your admin email; the sections below cover those and the database. Each host page lists where its settings go.

## Sign-in and admins {#github}

Drop signs in with **GitHub**. [Create a GitHub OAuth app](https://github.com/settings/applications/new) with:

- **Homepage URL**: `https://<your-domain>`
- **Authorization callback URL**: `https://<your-domain>/api/auth/callback/github`

Then set these on the deployment:

::docs-env
::

Drop reads its settings when it runs, so a change needs a restart, not a rebuild. Only the host and database are fixed at build time. Each setting also answers to a `VITEHUB_` name, such as `VITEHUB_DROP_GITHUB_ORG`, which wins when both are set. Booleans take `true`, `false`, `1`, or `0`; an invalid value stops Drop with an error naming the setting.

- **Who signs in.** Anyone with a GitHub account, as a Member. `DROP_MEMBERS` lets in only the people whose emails it lists, plus the admins, for publishing and viewing, shared links and MCP included. Like `DROP_ADMINS`, it compares emails a sign-in method verified, so it keeps working if you swap GitHub for another provider. Take someone off and restart, and they're out. `DROP_GITHUB_ORG` requires active membership of that organization instead; sign-in then asks for `read:org`. With both, a person needs both.
- **Who is Admin.** `DROP_ADMINS` lists admin emails, separated by commas or spaces, in any case. Whoever signs in with one, by a method that verified the email, is Admin. Restart to apply a change. In `nuxt dev` and with `DROP_TEST_SIGNIN`, an unverified email counts too.
- **Roles come only from that list.** Admins ban and unban members on the Members page.
- **Other sign-in.** Change the Better Auth options in `server/auth.ts`, or [reuse an existing GitHub oauth2-proxy](/docs/self-host/vps#auth-proxy).

::roles-table
::

## Team mode {#team-mode}

A Drop is **personal** by default, like drop.vitehub.dev: drops start Only me, and people share them by public link. `DROP_MODE=team` makes it a Drop one team runs for itself, usually behind `DROP_MEMBERS`, `DROP_GITHUB_ORG`, or [oauth2-proxy](/docs/self-host/vps#auth-proxy). Everyone signed in is then a teammate:

- New drops start shared with the Team.
- The sidebar leads with the **Team** tab: the team's folders, then teammates' drops shared with the team.
- Admins create team folders, with **New › Folder** and the team's folder switch, or **New team folder** on an empty Team tab, and write their descriptions. Everyone adds drops to them. [Team folders](/docs/review#folders) has the rules.

`DROP_PUBLIC_LINK_DAYS` sets how many days a public link stays open. Left empty, it's 7 on a team Drop and no limit on a personal one; `0` turns public links off. A closed link falls back to Team, or to Only me on a personal Drop. This is separate from a drop's lifetime.

```sh
DROP_MODE=team
DROP_ADMINS=you@example.com
DROP_GITHUB_ORG=your-org
DROP_PUBLIC_LINK_DAYS=7
```

## Teams on a personal Drop {#teams}

`DROP_TEAMS=true` lets people on a personal Drop make teams on **Teams**. A team works like a small team Drop inside yours: its owner and admins invite people by email and make its folders, and drops in those folders reach its members and their agents, nobody else. Drop sends no email, so whoever invites copies the link and sends it; the invitee joins by opening it, signed in with that email.

| Variable | What it does |
| --- | --- |
| [DROP_TEAMS]{.font-mono .text-xs} | Set true to turn teams on. Ignored on a team Drop, which is one team already. |
| [DROP_FREE_TEAM_MEMBERS]{.font-mono .text-xs} | Members a team has before it needs a subscription, invitations included. Defaults to 3. Applies only with billing on. |
| [DROP_FREE_KEPT]{.font-mono .text-xs} | Drops the Free plan keeps forever at once. Defaults to 10. Applies only with `DROP_QUOTAS=true`. |

### Bill teams through Stripe {#billing}

With billing on, a team past its free members needs the Team plan: one seat per member, kept in step with Stripe as people join and leave, with a 14-day trial. Everyone on a team that pays gets the Pro plan. `/pricing` shows the plans; without billing it's a 404.

| Variable | What it does |
| --- | --- |
| [STRIPE_SECRET_KEY]{.font-mono .text-xs} | Your Stripe secret key. |
| [STRIPE_WEBHOOK_SECRET]{.font-mono .text-xs} | The signing secret of a webhook to `<origin>/api/auth/stripe/webhook` that sends `checkout.session.completed` and the `customer.subscription.*` events. |
| [STRIPE_TEAM_PRICE_ID]{.font-mono .text-xs} | A recurring per-unit price for one member. |
| [STRIPE_TEAM_ANNUAL_PRICE_ID]{.font-mono .text-xs} | Optional: its yearly price, which adds a Pay yearly button. |
| [STRIPE_MANAGED_PAYMENTS]{.font-mono .text-xs} | Defaults to true: Stripe sells as merchant of record and files sales tax and VAT. Turn Managed Payments on in Stripe and give the product an eligible tax code. Set false to sell under your own account. |

Billing turns on once teams are on and the key, the webhook secret, and the price are all set.

## Give apps their own domain {#content-origin}

Apps and HTML docs run their own scripts, so by default Drop shows them in a sandbox with no origin, away from Drop and the reader's session. The sandbox also blocks `localStorage`, cookies, and URL changes. Drop swaps in temporary storage, but an app that routes by its URL breaks.

Set `DROP_CONTENT_ORIGIN` to a wildcard such as `https://*.drop-usercontent.example.com`, and serve every hostname under it from the same deployment. Each drop then runs on its own subdomain, as on a static host: storage and history work, and one app can't read what another stored. The subdomain is a hash of the drop's id, never the id, because hostnames are visible on the network.

- **Use a domain that serves nothing else**, ideally a separate registrable domain, because a page can set cookies for its parent domain. Drop's sign-in cookies use the `__Host-` prefix, and API writes that carry cookies must come from Drop's own origin.
- **DNS and certificate.** The wildcard needs a wildcard DNS record and a certificate that covers it. Cloudflare's free certificate covers one level under the zone, so `*.drop-usercontent.example.com` needs a paid one. To stay free on your own domain, put the `*` inside the first label: `https://*-drop.example.com` runs each drop at `<hash>-drop.example.com`.
- **No sign-in.** These hostnames serve a blank page that the viewer fills, so private drops never pass through them. Keep them outside oauth2-proxy or any other login wall.
- **A plain hostname** such as `https://drop-usercontent.example.com` also works, but every drop then shares that origin, and its storage.

## Expiry {#expiry}

Drops go to the Trash 30 days after their last visit (14 for temporary ones), stay restorable for 15 days, and are then deleted by the hourly cleanup job. [Review and share](/docs/review#expiry) explains what counts as a visit.

| Variable | What it does |
| --- | --- |
| [DROP_EXPIRY_DAYS]{.font-mono .text-xs} | Days a drop lives after its last visit. Defaults to 30. Set 0 to keep every drop. |
| [DROP_CUSTOM_EXPIRY]{.font-mono .text-xs} | Set false so only admins can keep drops. Defaults to true: owners and their agents can too. |

Shortening the window applies to existing drops at once.

## Abuse and moderation {#abuse}

| Setting or page | What it does |
| --- | --- |
| `DROP_SHARE_APPROVAL=true` | A member's public links wait until an admin approves that member on `/admin/review`. On a team Drop, a waiting link still reaches the team. Admins skip the wait, and links shared before you turn it on stay shared. |
| `/report` | Anyone reports a shared link. Admins see reports on `/admin/reports` and dismiss them, quarantine the drop, or ban its owner, which takes down all their drops. Each report logs a high-severity event; Drop sends no email. |
| `DROP_ABUSE_EMAIL` | Adds a public contact address to the abuse page. |

Before you open your Drop to the public, adapt `app/pages/terms.vue`, `acceptable-use.vue`, and `abuse.vue` to your jurisdiction, with a DMCA contact if you need one. Drops and their files are kept out of search engines.

## Logs {#logs}

Drop writes one structured [evlog](https://www.evlog.dev) event per request: who called, which agent, what it did, and why it failed. MCP tool calls, purges from the Trash, and abuse reports land there too. On Cloudflare they're in Workers Logs; elsewhere, in the host's log output.

## Database and migrations {#database}

VPS and Docker builds use local SQLite on persistent disk by default. The other hosts each use their own Cloudflare D1 database, over D1's HTTP API outside Cloudflare. All of them apply the migrations in `server/databases/migrations`.

To create a D1 database for a host outside Cloudflare:

```sh
npx wrangler login
npx wrangler d1 create my-drop
```

Put its id and name, your Cloudflare account id, and an account API token with Account › D1 › Edit, limited to your account, in the host's settings.

| Host | Applies migrations with |
| --- | --- |
| Cloudflare | `pnpm run deploy`, which the button runs. Workers Builds that run `npx wrangler deploy` need `pnpm db:migrate:remote` after schema changes. |
| Vercel, Netlify | `pnpm db:migrate:d1` after the build, before publishing. |
| Deno Deploy | `pnpm db:migrate:d1` as a pre-deploy command. |
| Docker Compose | Drizzle for SQLite, or `pnpm db:migrate:d1` for an explicit D1 build, before Drop starts. |

`pnpm db:migrate:d1` needs `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_D1_DATABASE_ID`. It records migrations in `d1_migrations` and skips those already applied.

Give previews their own D1 database, or turn preview deployments off: a build with production D1 credentials migrates production.

`0000_init.sql` creates a new database, and each later numbered migration changes it. Never edit a migration a database has already applied: it won't run again there. After you change the schema in `server/databases/`, `pnpm db:generate` writes the next migration.

## Pick a host {#hosts}

Cloudflare has everything Drop uses in one account. A VPS can keep all data on local disk. The serverless hosts use D1 over HTTP, one database per deployment.

::hosts-table
::

## Choose the host at build time {#build}

`DROP_HOST` picks the host when you build. Without it, Drop checks `NITRO_PRESET` or `SERVER_PRESET`, then Vercel, Netlify, or Deno markers, then a local `DROP_DATABASE_URL`, which selects VPS. With no signal, it builds for Cloudflare. Docker always builds for VPS.

```sh
DROP_HOST=vercel pnpm build   # explicit override: cloudflare, vercel, netlify, deno, or vps
```

`DROP_DATABASE=sqlite` or `DROP_DATABASE=d1` picks the database at build time. SQLite needs the VPS preset and persistent disk, and an existing D1 database id keeps a VPS build on D1. To change drivers, rebuild and migrate the data yourself.

`nuxt.config.ts` maps each host to its ViteHub preset and drivers, so the app's code stays the same on every host.

## What changes between hosts {#differences}

| | Cloudflare | Other hosts |
| --- | --- | --- |
| Code images | PNG (a Browser Run screenshot of the SVG) and SVG. | SVG only. Asking `create_code_image` for PNG fails with a clear error. |
| Rate limits | Cloudflare's rate limiting binding. | Counted in memory per server instance, so looser on serverless hosts. |
| Cleanup | Hourly. | Hourly on a VPS and Netlify, daily on Vercel so it works on Hobby. Deno Deploy has none: trashed drops and expired images stop being served but stay in the bucket. |
| Caching | Rendered Markdown and the file count in Workers KV. | In memory. |

The cleanup job moves expired drops to the Trash, deletes what has been there 15 days, and removes expired code images and OAuth clients unused for a day.

## Check a deployment {#check}

The smoke test checks the public pages, the OAuth discovery documents, that `/mcp` asks agents to sign in, and the skills index. Add `DROP_TOKEN=<an MCP access token>` to also run uploads, sharing, and the MCP tools.

```sh
DROP_URL=https://<your-domain> pnpm test:e2e:deployed
```

## Develop locally {#develop}

```sh
pnpm install
pnpm db:migrate   # once, and after schema changes
pnpm dev          # http://localhost:3000
```

Local dev runs against a local D1 and keeps files in `.vitehub/data/blob`. It has no GitHub app, so it also allows email and password sign-in: open `/?signin=1`.
