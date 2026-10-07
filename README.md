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
4. **The agent reads the open comments** and drops the next version. Older versions stay in history.

Under the hood:

- **Auth** is Better Auth through `vite-hub/auth`: GitHub sign-in, admin roles, and an OAuth 2.1 provider that MCP clients sign in through (dynamic client registration, PKCE, JWT access tokens bound to `/mcp`).
- **Database** is SQLite through `vite-hub/database`: D1 on Cloudflare, Turso (libSQL) on Vercel, Netlify, and Deno Deploy, a SQLite file on a VPS. It holds drops, app files, and comments.
- **Blob** stores every file at `/f/<key>`. Old `/i/<key>` links redirect there.
- Markdown renders through **Comark**, and HTML runs in a sandbox with an opaque origin.
- **Code images** come from Shiki as SVG; on Cloudflare, a single **Browser** screenshot action turns them into PNG. An hourly **Schedule** deletes them.
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

| Host | Build | Database | Files | Guide |
| --- | --- | --- | --- | --- |
| Cloudflare (default) | `pnpm build` | D1 | R2 | [/docs/self-host/cloudflare](https://drop.vitehub.dev/docs/self-host/cloudflare) |
| Vercel | `DROP_HOST=vercel pnpm build` | Turso | Vercel Blob | [/docs/self-host/vercel](https://drop.vitehub.dev/docs/self-host/vercel) |
| Netlify | `DROP_HOST=netlify pnpm build` | Turso | Netlify Blobs | [/docs/self-host/netlify](https://drop.vitehub.dev/docs/self-host/netlify) |
| Deno Deploy | `DROP_HOST=deno pnpm build` | Turso | S3-compatible bucket | [/docs/self-host/deno](https://drop.vitehub.dev/docs/self-host/deno) |
| VPS (Node) | `DROP_HOST=vps pnpm build` | SQLite file | Local disk | [/docs/self-host/vps](https://drop.vitehub.dev/docs/self-host/vps) |

Only Cloudflare renders PNG code images (Browser Run) and has a distributed rate limiter; elsewhere code images are SVG and rate limits count per instance. Migrations apply with `pnpm db:migrate:remote` (D1) or `pnpm db:migrate:libsql` (Turso or the VPS's SQLite file).

Anyone with a GitHub account can sign in and joins as a Member. The GitHub users in `DROP_ADMINS` join as Admin, and admins change roles on `/members`:

| Role | What they can do |
| --- | --- |
| **Admin** | Everything, plus members. |
| **Editor** | Edit and share any drop. |
| **Member** | Their own drops. This is the default. |

On Cloudflare:

1. Create a GitHub OAuth app with the callback `https://<your-domain>/api/auth/callback/github`. To use another sign-in provider, edit [server/auth.ts](./server/auth.ts).
2. Create the Cloudflare resources.

   ```sh
   pnpm install
   pnpm exec wrangler d1 create vitehub-drop   # copy the id into CLOUDFLARE_D1_DATABASE_ID
   pnpm exec wrangler r2 bucket create vitehub-drop
   pnpm build
   ```

   The KV namespace (Drop's render cache) has no ID to fill in: Wrangler creates it on the first deploy.

3. Fill `.env` from [.env.example](./.env.example), with your GitHub user id (`gh api users/<login> --jq .id`) in `DROP_ADMINS`. Then deploy. Deploy applies the D1 migrations, then publishes the Worker with `.env` as its secrets:

   ```sh
   pnpm run deploy
   ```

4. Run the smoke test. It checks the public pages, the OAuth discovery documents, and that `/mcp` asks for sign-in:

   ```sh
   DROP_URL=https://<your-domain> pnpm test:e2e:deployed
   ```

### Develop locally

```sh
pnpm install
pnpm dev          # http://localhost:3000
pnpm db:migrate   # once, and after schema changes (pnpm db:generate writes new migrations)
```

Local dev has no GitHub app, so `nuxt dev` also allows email and password sign-in: open `/?signin=1`. Files go to `.vitehub/data/blob`, and rate limits are off.

The hand mark is [Twemoji](https://github.com/twitter/twemoji) via [Iconify](https://iconify.design/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
