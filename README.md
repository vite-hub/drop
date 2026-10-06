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

1. **Agents drop their work** with an API key or over MCP: a plan in Markdown, an HTML report, an image, or a small static app made of files.
2. **Every drop starts private.** Only its owner (and the workspace's editors and admins) can open it.
3. **People review it** full screen: select text or click a spot in an image to comment. The owner shares a link that can view, comment, or edit.
4. **The agent reads the open comments** and drops the next version. Older versions stay in history.

Under the hood:

- **Auth** is Better Auth through `vite-hub/auth`: GitHub sign-in, admin roles, and API keys.
- **Database** is D1 through `vite-hub/database`: drops, app files, and comments.
- **Blob** stores every file at `/f/<key>`. Old `/i/<key>` links redirect there.
- Markdown renders through **Comark**, and HTML runs in a sandbox with an opaque origin.
- **Code images** come from Shiki as SVG; a single **Browser** screenshot action turns them into PNG, and an hourly **Schedule** deletes them.

## Use Drop

1. Create an API key at `/agents`. Name it after the agent that uses it (like "Claude Code"); drops it makes show that name and logo.
2. Connect the agent. The easiest way is MCP:

   ```sh
   claude mcp add --transport http --scope user drop https://drop.vitehub.dev/mcp \
     --header "Authorization: Bearer $DROP_API_KEY"
   ```

   Or install the skill, which uses the HTTP API:

   ```sh
   npx skills add https://drop.vitehub.dev
   ```

3. Drop a file:

   ```sh
   curl --fail-with-body -H "x-api-key: $DROP_API_KEY" \
     -F "file=@plan.md" https://drop.vitehub.dev/api/files
   ```

   This returns `{ id, url, page, visibility, version }`. `page` is the review page and `url` serves the file. Add `-F supersedes=<id>` to publish the next version.

MCP tools: `list_drops`, `read_drop`, `list_comments`, `create_doc`, `publish_app`. The `/docs` page lists every endpoint.

### Create a code image

```sh
curl --fail-with-body https://drop.vitehub.dev/api/code \
  -H "x-api-key: $DROP_API_KEY" -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"typescript","theme":"github-dark","format":"png","scale":4}'
```

It returns `{ url, expiresAt }`. The image is public and lasts five minutes; drop it to keep it.

## Host it yourself

Drop is a Nuxt app on Cloudflare Workers. The first person to sign in becomes the admin. After that, Drop is invite-only: admins add people on `/members`, with one of three roles:

| Role | What they can do |
| --- | --- |
| **Admin** | Everything, plus members. |
| **Editor** | Edit and share any drop. |
| **Member** | Their own drops. This is the default. |

1. Create a GitHub OAuth app with the callback `https://<your-domain>/api/auth/callback/github`. To use another sign-in provider, edit [server/auth.ts](./server/auth.ts).
2. Create the Cloudflare resources.

   ```sh
   pnpm install
   pnpm exec wrangler d1 create vitehub-drop   # copy the id into CLOUDFLARE_D1_DATABASE_ID
   pnpm exec wrangler r2 bucket create vitehub-drop
   pnpm build
   ```

3. Fill `.env` from [.env.example](./.env.example), then deploy. Deploy applies the D1 migrations, then publishes the Worker with `.env` as its secrets:

   ```sh
   pnpm run deploy
   ```

4. Run the smoke test with a key from `/agents`:

   ```sh
   DROP_URL=https://<your-domain> DROP_API_KEY=drop_… pnpm test:e2e:deployed
   ```

### Develop locally

```sh
pnpm install
pnpm dev          # http://localhost:3000
pnpm db:migrate   # once, and after schema changes (pnpm db:generate writes new migrations)
```

Local dev has no GitHub app, so `nuxt dev` also allows email and password sign-in: open `/?signin=1`. Files go to `.vitehub/data/blob`, and rate limits are off.

The hand mark is [Twemoji](https://github.com/twitter/twemoji) via [Iconify](https://iconify.design/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
