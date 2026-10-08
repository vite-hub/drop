<p align="center">
  <a href="https://drop.vitehub.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./public/logo-light.svg">
      <img alt="Drop" src="./public/logo-light.svg" width="220" height="84" style="max-width: 100%;">
    </picture>
  </a>
</p>

<p align="center">Review what your agents plan. Agents drop docs and small apps; you comment on the exact spot and share the ones worth sharing. Built with ViteHub.</p>

<p align="center">
  <a href="https://drop.vitehub.dev">Website</a> ·
  <a href="https://vitehub.dev">ViteHub</a> ·
  <a href="https://vitehub.dev/docs/">ViteHub docs</a> ·
  <a href="https://github.com/vite-hub/drop">Source</a>
</p>

## How it works

1. **Agents drop their work** over MCP: a plan in Markdown, an HTML report, or a small static app made of files. They sign in through your browser once; there are no keys.
2. **Every drop starts private.** Only its owner (and the workspace's editors and admins) can open it.
3. **People review it** full screen: select text or click a spot in an image to comment. The owner shares a link that can view, comment, or edit.
4. **The agent reads the open comments** and drops the next version. Older doc versions stay in history. Apps keep only their latest file set; publishing replaces it and deletes the old files.

Under the hood:

- **Auth** is Better Auth through `vite-hub/auth`: GitHub sign-in, admin roles, and an OAuth 2.1 provider that MCP clients sign in through (dynamic client registration, PKCE, JWT access tokens bound to `/mcp`).
- **Database** is SQLite through `vite-hub/database`: D1 on every host, using D1's HTTP API outside Cloudflare. It holds drops, app files, and comments.
- **Blob** stores every file at `/f/<key>`. Old `/i/<key>` links redirect there.
- Markdown renders through **Comark**, and HTML runs in a sandbox with an opaque origin.
- **Code images** come from Shiki as SVG; on Cloudflare, a single **Browser** screenshot action turns them into PNG. A **Schedule** deletes them hourly on Cloudflare, Netlify, and a VPS, or daily on Vercel.
- **MCP** is [nitro-mcp-toolkit](https://github.com/nuxt-modules/mcp-toolkit): one file per tool and prompt in `server/mcp/`, both protocol revisions, and the [Skills extension](https://modelcontextprotocol.io/seps/2640-skills-extension).
- **Skills** are defined once in `skills/` and served over MCP (`skills/list`, `skill://` resources), at `/.well-known/agent-skills/` ([Discovery v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc)), and at the older `/.well-known/skills/`.
- **Logs** are [evlog](https://www.evlog.dev) wide events: one structured line per request with the caller, the agent, what it did, and why it failed. Workers Logs is on, so they're queryable in the Cloudflare dashboard.

## Use Drop

1. Sign in at [drop.vitehub.dev](https://drop.vitehub.dev) with GitHub.
2. Add Drop's MCP server to your agent:

   ```sh
   claude mcp add --transport http --scope user drop https://drop.vitehub.dev/mcp
   ```

   The first time it connects, the client opens Drop in your browser. Allow it, and the agent acts as you. The `/agents` page has the setup for Codex, Cursor, VS Code, and other clients, and lists the agents you've connected.
3. Ask your agent to drop a plan. It answers with the review link.

MCP tools: `list_drops`, `read_drop`, `list_comments`, `create_doc`, `publish_app`, `create_code_image`, plus the `address_feedback` prompt. The `vitehub-drop` skill comes with the server (`skills/list`); it's also published at `/.well-known/agent-skills/` for agents that discover skills over HTTP. [The docs](https://drop.vitehub.dev/docs) have the details.

## Host it yourself

[drop.vitehub.dev](https://drop.vitehub.dev) is one instance anyone can use; you can run your own. `DROP_HOST` picks the host at build time, and [the self-hosting docs](https://drop.vitehub.dev/docs/self-host) have the steps for each:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop) [![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop&env=GITHUB_CLIENT_ID%2CGITHUB_CLIENT_SECRET%2CBETTER_AUTH_SECRET%2CDROP_ADMINS%2CCLOUDFLARE_ACCOUNT_ID%2CCLOUDFLARE_API_TOKEN%2CCLOUDFLARE_D1_DATABASE_ID%2CCLOUDFLARE_D1_DATABASE_NAME&envDescription=GitHub+sign-in%2C+admin+user+IDs%2C+Cloudflare+D1%2C+and+a+private+Blob+store.+See+the+Drop+guide+for+each+value.&envLink=https%3A%2F%2Fdrop.vitehub.dev%2Fdocs%2Fself-host%2Fvercel&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D) [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop) [![Deploy on Deno](https://deno.com/button)](https://console.deno.com/new?clone=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop) [Run on a VPS](https://drop.vitehub.dev/docs/self-host/vps#steps)

Cloudflare creates D1, R2, and KV for you. Vercel and Netlify prompt for settings. Deno clones the repo and reads `deno.jsonc`; the VPS guide uses Docker Compose. No button creates your GitHub OAuth app. Use `<origin>/api/auth/callback/github` as its callback, generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`, and find your admin user id with `gh api users/<login> --jq .id`.

Other hosts need a Cloudflare D1 database and an account API token with D1 edit access. Choose a private Blob store in the Vercel flow; Deno needs an S3 bucket and access keys. The provider guides cover these steps. Migrations run before deployment; existing Cloudflare Workers Builds that use `pnpm build` and `npx wrangler deploy` still need `pnpm db:migrate:remote` after schema changes.

Only Cloudflare renders PNG code images and has a distributed rate limiter. Elsewhere code images are SVG and rate limits count per instance. Anyone who signs in joins as a Member; GitHub user ids in `DROP_ADMINS` join as Admin. Admins change roles on `/members`.

### Develop locally

```sh
pnpm install
pnpm dev          # http://localhost:3000
pnpm db:migrate   # once, and after schema changes (pnpm db:generate writes new migrations)
```

Local dev has no GitHub app, so `nuxt dev` also allows email and password sign-in: open `/?signin=1`. Files go to `.vitehub/data/blob`, and rate limits are off.

The hand mark is [Twemoji](https://github.com/twitter/twemoji) via [Iconify](https://iconify.design/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
