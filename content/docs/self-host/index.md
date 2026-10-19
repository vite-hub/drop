---
title: Host it yourself
description: Run your own Drop on Cloudflare, Vercel, Netlify, Deno Deploy, or a VPS.
---

::docs-deploy-buttons
::

Start with the button for your host. You still supply GitHub sign-in and your admin email. The steps below cover those values and the database.

## Sign-in and admins {#github}

Drop signs in with GitHub. You can also [reuse an existing GitHub oauth2-proxy](/docs/self-host/vps#auth-proxy). For native sign-in, [Create a GitHub OAuth app](https://github.com/settings/applications/new) with:

- **Homepage URL**: `https://<your-domain>`
- **Authorization callback URL**: `https://<your-domain>/api/auth/callback/github`

Then give the deployment these settings. Each host page says where they go. Drop reads its settings when it runs, so changing one needs a restart, not a rebuild; only the host and database choices below are fixed at build time. Each setting also answers to a `VITEHUB_` name, such as `VITEHUB_DROP_GITHUB_ORG`, which wins when both are set. Booleans take `true`, `false`, `1`, or `0`, and an invalid value stops Drop with an error naming the setting.

::docs-env
::

By default, anyone with a GitHub account can sign in and joins as a Member. Set `DROP_GITHUB_ORG` to require active organization membership for publishing and viewing, including shared links and MCP. GitHub sign-in then requests `read:org`.

`DROP_ADMINS` lists admin emails, separated by commas or spaces; case doesn't matter. Whoever signs in with one of them is an Admin, as long as their sign-in method verified the email, so an admin stays one after switching from GitHub to another provider. Drop reads the list on every request: to add or remove an admin, change it and restart. Nobody changes roles on the Members page; admins ban and unban members there. In `nuxt dev` and with `DROP_TEST_SIGNIN`, an unverified email counts too. To use another sign-in provider, change the Better Auth options in `server/auth.ts`.

::roles-table
::

## Team mode {#team-mode}

By default a Drop is personal, like drop.vitehub.dev: drops start Only me, and people share them by public link. Set `DROP_MODE=team` for a Drop that one team runs for itself, usually behind `DROP_GITHUB_ORG` or [oauth2-proxy](/docs/self-host/vps#auth-proxy). Everyone signed in is then a teammate:

- New drops start shared with the Team: everyone signed in opens them and comments. People pick Only me to keep a draft to themselves, or Team can edit to edit a Markdown doc together.
- The sidebar leads with Team. Its tab lists the team's folders, then teammates' drops shared with the team.
- Admins create team folders in the browser: **New › Folder** with the team's folder switch on, or **New team folder** on an empty Team tab. Everyone on the team, and their agents, adds drops to them. A drop in a team folder stays its publisher's and counts against their plan. Team folders never expire and can't be Only me.
- Only admins rename, describe, share, or trash a team folder, and add subfolders to it. Anyone on the team can move a drop in one to the Trash from the browser; it goes to its owner's Trash, where the owner or an admin restores it.

Every folder has a description of what goes in it and how to name and write it, such as "Notes from calls, one doc per meeting, named YYYY-MM-DD-topic." Admins write the team folders' descriptions. Agents read them with `list_folders` before they publish, and put each new drop in the folder that fits.

`DROP_PUBLIC_LINK_DAYS` sets how many days a public link stays open. Left empty, it's 7 on a team Drop and no limit on a personal one; `0` turns public links off. When a link closes, the drop falls back to Team on a team Drop, or Only me on a personal one, and picking Public again starts the window over. This is separate from a drop's lifetime, which decides when the drop itself goes to the Trash.

A team deployment's settings:

```sh
DROP_MODE=team
DROP_ADMINS=you@example.com
DROP_GITHUB_ORG=your-org
DROP_PUBLIC_LINK_DAYS=7
```

## Give apps their own domain {#content-origin}

Apps and HTML docs run their own scripts. By default Drop shows them in a sandbox with no origin, so they can't reach Drop or the reader's session. That sandbox also blocks `localStorage`, cookies, and URL changes. Drop swaps in temporary storage, but an app that routes by its URL still breaks.

Set `DROP_CONTENT_ORIGIN` to a wildcard such as `https://*.drop-usercontent.example.com` and serve every hostname under it from the same deployment. Each drop then runs on a subdomain of its own, the way each app on a static host gets its own site: storage and history work, and one app can't read what another stored. The subdomain is a hash of the drop's id, never the id itself, because hostnames are visible on the network and a shared drop's id opens its link.

- Use a domain that serves nothing else. A separate registrable domain is the strongest boundary, because a page can set cookies for its parent domain: under `example.com`, apps could set cookies that reach `example.com` and every other drop. Drop's sign-in cookies use the `__Host-` prefix, so no subdomain can replace them, and API writes that carry cookies must come from Drop's own origin.
- The wildcard needs a wildcard DNS record and a certificate that covers it. Cloudflare's free certificate covers one level under the zone, so `*.drop-usercontent.example.com` needs a paid one. To stay on your own domain for free, put the `*` inside the first label instead: `https://*-drop.example.com` runs each drop at `<hash>-drop.example.com`, and only names ending in `-drop` reach Drop.
- The hostnames only serve a blank page. The viewer sends each document to it, so private drops never pass through them and they need no sign-in. Keep them outside oauth2-proxy or any other login wall.
- A plain hostname (`https://drop-usercontent.example.com`) also works, but then every drop shares that one origin, so an app can read what another app stored in the same browser.

## Expiry {#expiry}

Drops expire 30 days after their last visit (14 for temporary ones) into the Trash, stay restorable for 15 days, and are then deleted by the hourly cleanup job. [Review and share](/docs/review#expiry) explains what counts as a visit.

| Variable | What it does |
| --- | --- |
| [DROP_EXPIRY_DAYS]{.font-mono .text-xs} | Days a drop lives after its last visit. Defaults to 30. Set 0 to keep every drop. |
| [DROP_CUSTOM_EXPIRY]{.font-mono .text-xs} | Set false so only admins can keep drops. Defaults to true: owners and their agents can too. |

Shortening the window applies to existing drops at once.

## Abuse and moderation {#abuse}

On a Drop open to anyone with a GitHub account, set `DROP_SHARE_APPROVAL=true` so a member's public links wait until an admin approves that member. Everything else keeps working: on a team Drop, a public link waiting for review still reaches the team. Admins skip the wait. Approve or reject members on `/admin/review`; once approved, a member shares freely. Links shared before you turn it on stay shared, so approve trusted members first if they'll publish new versions.

Anyone can report a shared link at `/report`. Reports land on `/admin/reports`, where admins dismiss them, quarantine the reported drop, or ban its owner, which takes down all of their drops. Each report also logs a high-severity event; Drop sends no email, so watch your logs. `DROP_ABUSE_EMAIL` adds a public contact address to the abuse page.

Before opening your Drop to the public, adapt the templates in `app/pages/terms.vue`, `acceptable-use.vue`, and `abuse.vue` to your jurisdiction, including a DMCA contact if you need one. Drops and their files are kept out of search engines.

## Logs {#logs}

Drop writes one structured [evlog](https://www.evlog.dev) event per request: who called, which agent, what it did, and why it failed. MCP tool calls, purges from the Trash, and abuse reports land there too. On Cloudflare they're in Workers Logs; elsewhere they go to the host's log output.

## Database and migrations {#database}

Docker and VPS builds default to local SQLite on persistent disk. The other hosts use separate Cloudflare D1 databases, with D1's HTTP API outside Cloudflare. The same migrations in `server/databases/migrations` apply to all of them:

For a deployment that uses D1 outside Cloudflare, create it from a machine with Node.js:

```sh
npx wrangler login
npx wrangler d1 create my-drop
```

Copy its id and name, your Cloudflare account id, and an account API token with Account, D1, Edit permission into the host's settings. Limit the token to your account.

From your cloned repository, `pnpm db:migrate:d1` needs `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_D1_DATABASE_ID` in its environment. It records migrations in `d1_migrations` and skips those already applied.

- Cloudflare's button runs `pnpm run deploy`, which applies migrations by the `DB` binding. Existing Workers Builds using `npx wrangler deploy` still need `pnpm db:migrate:remote` after schema changes.
- Vercel and Netlify run `pnpm db:migrate:d1` after building, before publishing.
- Deno runs it as a pre-deploy command. Docker Compose uses Drizzle for SQLite, or this command for an explicit D1 build, before starting Drop.

Use a separate D1 database for previews, or disable preview deployments. A build with production D1 credentials migrates that database.

Drop keeps its whole schema in one file, `0000_init.sql`, which creates a new database. A database created from an earlier release doesn't pick up later schema changes on its own: apply them by hand. After you change the schema in `server/databases/`, `pnpm db:generate` writes the next migration.

## Pick a host {#hosts}

Cloudflare has everything Drop uses in one account. VPS builds can keep all data on local disk; the serverless hosts use D1 over HTTP with a separate database per deployment. Every host but Cloudflare renders code images as SVG only.

::hosts-table
::

## Choose the host at build time {#build}

`DROP_HOST` explicitly picks the host when you build. Otherwise Drop detects `NITRO_PRESET` or `SERVER_PRESET`, then Vercel, Netlify, or Deno environment markers. A local `DROP_DATABASE_URL` selects VPS when no host is selected. With no signal, it builds for Cloudflare. Docker always selects VPS.

```sh
DROP_HOST=vercel pnpm build   # explicit override: cloudflare, vercel, netlify, deno, or vps
```

Use `DROP_DATABASE=sqlite` or `DROP_DATABASE=d1` to choose the database at build time. SQLite requires the VPS preset and persistent disk. An existing D1 database id keeps a VPS build on D1. Rebuild to change drivers and migrate data separately.

`nuxt.config.ts` maps each host to its ViteHub preset and drivers: the database, file storage, rate limiting, and the job that deletes expired code images. Your code doesn't change; ViteHub swaps the drivers behind `vite-hub/database`, `vite-hub/blob`, and the rest.

## What changes between hosts {#differences}

- **Code images.** PNG is a Cloudflare Browser Run screenshot of the SVG, so only Cloudflare has it. Elsewhere `create_code_image` returns SVG, and asking for PNG fails with a clear error.
- **Rate limits.** Cloudflare uses its rate limiting binding. Other hosts count in memory, per server instance, so limits are looser on serverless hosts that run many instances.
- **Cleanup.** An hourly job moves expired drops to the Trash, deletes what has been there 15 days, and removes expired code images and OAuth clients unused for a day. Vercel runs it daily so it works on Hobby. Deno Deploy has none; trashed drops and expired images stop being served but stay in the bucket.
- **Caching.** Rendered Markdown and the file count are cached in Workers KV on Cloudflare, and in memory elsewhere.

## Check a deployment {#check}

The smoke test checks the public pages, the OAuth discovery documents, that `/mcp` asks agents to sign in, and the skills index:

```sh
DROP_URL=https://<your-domain> pnpm test:e2e:deployed
```

Add `DROP_TOKEN=<an MCP access token>` to also run the signed-in flow: uploads, sharing, and MCP tools.

## Develop locally {#develop}

```sh
pnpm install
pnpm db:migrate   # once, and after schema changes
pnpm dev          # http://localhost:3000
```

Local dev runs against a local D1 and keeps files in `.vitehub/data/blob`. It has no GitHub app, so it also allows email and password sign-in: open `/?signin=1`.
