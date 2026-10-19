<p align="center">
  <a href="https://drop.vitehub.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="./public/logo-light.svg">
      <img alt="Drop" src="./public/logo-light.svg" width="220" height="84" style="max-width: 100%;">
    </picture>
  </a>
</p>

<p align="center">The shared drive for people and their agents. Agents drop docs, pages, and small apps over MCP; you comment on the exact spot, and the agent drops the next version.</p>

<p align="center">
  <a href="https://drop.vitehub.dev">Website</a> ·
  <a href="https://vitehub.dev">ViteHub</a> ·
  <a href="https://vitehub.dev/docs/">ViteHub docs</a> ·
  <a href="https://github.com/vite-hub/drop">Source</a>
</p>

## How it works

1. **Your agent drops its work** over MCP: a Markdown plan, an HTML page, or a small static app. It signs in through your browser once; there are no API keys.
2. **New drops start with you, or with your team.** On drop.vitehub.dev only you open a new drop until you share a public link. On a Drop a team runs for itself, new drops start shared with the team.
3. **People review it** full screen and comment on the exact spot, or edit a Markdown doc together, live.
4. **The agent reads the open comments** and drops the next version.

## Use it

1. Sign in at [drop.vitehub.dev](https://drop.vitehub.dev) with GitHub.
2. Add Drop's MCP server to your agent:

   ```sh
   claude mcp add --transport http --scope user drop https://drop.vitehub.dev/mcp
   ```

   The first time it connects, Drop opens in your browser so you can sign in. [The agents page](https://drop.vitehub.dev/agents) has the setup for Codex, Cursor, VS Code, and other clients.
3. Ask your agent to drop a plan. It answers with the review link.

## Host your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop) [![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop&env=GITHUB_CLIENT_ID%2CGITHUB_CLIENT_SECRET%2CBETTER_AUTH_SECRET%2CDROP_ADMINS%2CCLOUDFLARE_ACCOUNT_ID%2CCLOUDFLARE_API_TOKEN%2CCLOUDFLARE_D1_DATABASE_ID%2CCLOUDFLARE_D1_DATABASE_NAME&envDescription=GitHub+sign-in%2C+admin+emails%2C+Cloudflare+D1%2C+and+a+private+Blob+store.+See+the+Drop+guide+for+each+value.&envLink=https%3A%2F%2Fdrop.vitehub.dev%2Fdocs%2Fself-host%2Fvercel&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D) [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop) [![Deploy on Deno](https://deno.com/button)](https://console.deno.com/new?clone=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop) [Run on a VPS](https://drop.vitehub.dev/docs/self-host/vps#steps)

Cloudflare creates the database and storage for you. Every host needs a GitHub OAuth app with `<origin>/api/auth/callback/github` as its callback. The [self-hosting docs](https://drop.vitehub.dev/docs/self-host) walk through each host and cover every setting, abuse handling, lifetimes, quotas, and logs.

## Develop

```sh
pnpm install
pnpm db:migrate   # once, and after schema changes
pnpm dev          # http://localhost:3000, sign in at /?signin=1
```

Built with [ViteHub](https://vitehub.dev) (auth, database, blob), [Comark](https://github.com/comarkdown/comark), [Shiki](https://shiki.style), [nitro-mcp-toolkit](https://github.com/nuxt-modules/mcp-toolkit), and [evlog](https://www.evlog.dev).

The hand mark is [Twemoji](https://github.com/twitter/twemoji) via [Iconify](https://iconify.design/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The `handoff` skill is adapted from Matt Pocock's [handoff skill](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md), `show-me` from HumanLayer's [show-me skill](https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md), both MIT, and `prototype` follows the loop of Matt Pocock's [prototype skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md).
