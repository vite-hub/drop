---
title: Introduction
description: Drop is where your agents put their plans, docs, and small apps for you to review. You comment on the exact spot, share the ones worth sharing, and the agent reads your feedback and drops the next version.
---

## How it works {#how-it-works}

1. **Agents drop their work** over MCP: a plan in Markdown, an HTML report, or a small static app made of files.
2. **Drops start with their owner, or with the team.** On a personal Drop, like drop.vitehub.dev, a new drop is Only me: its owner and the admins open it. On a Drop a team runs for itself, new drops start shared with the Team.
3. **People review it** full screen. Select text or click a spot in an image to comment. The owner shares it with the team, who can also edit a Markdown doc together, or with anyone who has a public link.
4. **The agent reads the open comments** and drops the next version. Older doc versions stay in history. Apps keep only their latest file set.

## Get started {#get-started}

1. Sign in at :intro-origin with GitHub. Anyone with a GitHub account can.
2. Add Drop's MCP server to your agent. With Claude Code:

   ::mcp-snippet{client="claude"}
   ::

   The first time it connects, the client opens Drop in your browser. Allow it, and the agent acts as you. [Connect an agent](/docs/agents) has the setup for Claude, ChatGPT, Codex, Cursor, VS Code, and other clients.
3. Ask your agent to drop a plan, for example "Write a plan for the billing migration and drop it for review." It answers with the review link.

## What a drop is {#drops}

A drop is something an agent, or you, published for review:

- A **doc**: Markdown, or a self-contained HTML page. Markdown renders with tables, task lists, callouts, footnotes, and Mermaid diagrams. HTML runs as-is, scripts included, in a sandbox.
- An **app**: a folder of static files with an `index.html`, like a prototype or a dashboard.
- A **file** you upload: an image, a PDF, a log. Spreadsheets (CSV, TSV, XLSX, XLS, ODS) open as a read-only grid, one tab per sheet, showing the values as last saved. Videos (MP4, WebM) play in the viewer.

Every drop opens full screen and has its own link. Docs keep earlier versions; publishing an app replaces its files and deletes the old files. Each drop has a [lifetime](/docs/review#expiry): one nobody opens for a while goes to the Trash, unless it's kept. [Review and share](/docs/review) covers comments, sharing, versions, lifetimes, and the Trash, and [Features](/docs/features) shows each part of Drop with a screenshot.

## Plans and limits {#plans}

Quotas are off unless the operator turns them on. When they're on, everyone in the Drop gets the same plan, set in the environment. Free includes 50 drops, 100 MiB of storage, and 1,000 file writes per calendar month. An app can contain up to 300 files and 10 MiB. Pro includes 100 drops, 1 GiB, and 10,000 writes per month, with apps up to 1,000 files and 25 MiB. Unlimited has no owner limits.

A drop is one doc, app, or uploaded file with its version chain. Every retained document version and app file counts toward storage. A document version uses one write; an app publish uses one per file. Temporary code images use one write and no drop slot; their bytes count until cleanup deletes them. The owner's plan applies even when someone else edits.

At a limit, your existing drops and shared links keep working. Revisions are allowed while storage and writes remain available. Moving a drop to the Trash frees its slot; its storage is freed when it's deleted for good, 15 days later or when you empty the Trash. Files a doc embeds don't take a slot. Deleting never refunds monthly writes. Monthly budgets reset at the start of each UTC calendar month. Publishing also has a short burst limit.

Operators set `DROP_QUOTAS=true` to turn quotas on and `DROP_DEFAULT_PLAN` to `free`, `pro`, or `unlimited`; `DROP_PRO_DROPS`, `DROP_PRO_BYTES`, and `DROP_PRO_WRITES` change the Pro limits. Like every Drop setting, they're read at runtime, so a restart applies them. For other limits, [deploy your own](/docs/self-host).

## Roles {#roles}

Everyone who signs in joins as a Member. The people whose emails the operator lists in `DROP_ADMINS` are Admins, whichever way they sign in. Roles come from that list, not from the Members page, where admins ban and unban members.

::roles-table
::

## Use ours or run your own {#your-own}

[drop.vitehub.dev](https://drop.vitehub.dev) is one Drop anyone can use. Drop is open source and built on [ViteHub](https://vitehub.dev), so you can run your own on Cloudflare, Vercel, Netlify, Deno Deploy, or a server of yours. [Host it yourself](/docs/self-host) compares them.
