---
title: Connect an agent
description: Agents reach Drop over MCP. They sign in through your browser once; there are no keys to paste. Drop's skills come with the server.
---

## Add the server {#add-the-server}

::mcp-clients
::

Signed in, the Agents page lists the clients you've connected, and disconnecting one revokes its access.

### Claude Code and Codex plugin {#plugin}

For drop.vitehub.dev, the Drop plugin adds the server and the [skills](#skill) in one install. Sign in before using Drop tools:

- **Claude Code:** Run `claude plugin marketplace add vite-hub/drop`, then `claude plugin install drop@drop`. In Claude Code, open `/mcp`, select the Drop plugin server, and authenticate in your browser.
- **Codex:** Run `codex plugin marketplace add vite-hub/drop`, then `codex plugin add drop@drop`. Run `codex mcp login drop` and finish signing in through your browser.

Then `/drop:feedback` in Claude Code, or `$feedback` in Codex, lists the comments you sent with [Send](/docs/review) and answers the one you pick. To have Send reach it, run Send once on a drop, paste the setup prompt it copies, and press **Allow and send** when the pill asks.

## How sign-in works {#sign-in}

Drop is an OAuth 2.1 authorization server for its own MCP endpoint. When a client first connects:

1. `/mcp` answers `401` and points the client at `/.well-known/oauth-protected-resource/mcp`, which names Drop as the authorization server.
2. The client registers itself (dynamic client registration) and opens Drop's consent page in your browser, with PKCE.
3. You sign in with GitHub if you haven't, and allow the client.
4. The client keeps a token that only works for this Drop's `/mcp`, and the agent acts as you. Drops it makes show the client's name, like "Claude Code".

Clients that discover the issuer directly find it at `/.well-known/oauth-authorization-server/api/auth`.

## Skills {#skill}

Drop's skills come with the server through the MCP Skills extension (`skills/list` and `skill://` resources), so connected clients that support skills load them on their own:

- `vitehub-drop` tells agents how to drop docs, publish apps, read feedback, and write documents people can review.
- `pr-evidence` builds the before and after for a pull request that changes something visible: screenshots with hand-drawn marks and notes, dropped in Drop, and a comment on the pull request that links to it.
- `handoff` sums up the current conversation in a doc and drops it, so another agent, a colleague, or a new session picks the work up from the link.
- `prototype` builds a UI several genuinely different ways on one page that opens as a canvas: every version side by side at its real size, live, with deployed previews as items beside the sketches. People open one full size, comment on the one they mean, and pick one; each round of feedback becomes the next version.
- `data-explorer` turns a dataset, such as a CSV, an export, or what your agent pulls from PostHog or another tool, into one interactive page: findings, charts, matrices and tables behind tabs, and a sidebar where a click on any name filters the whole page. Publish it to Drop and a rebuild on new data becomes the next version at the same link.
- `show-me` explains the current topic with diagrams and short docs in Drop. Agents use it only when you ask for it.
- `learning` keeps a model of what you know per topic in a `learning` folder, with the answers behind it and when each concept is due for review, so a lesson starts where your knowledge stops. It also quizzes you, in chat or in a doc, to place you on a new topic or review what's due. The first time, it suggests the folders to create.
- `skill-hub` shares agent skills through a Drop folder: it publishes a skill from your disk into the folder, and installs one from it into the agents you pick. See [Share skills from a folder](#skill-hub).

The **Skills** page lists the skills this Drop serves, each with its source on GitHub. An admin can switch a skill off there so this Drop instance no longer serves it. This does not change the skills bundled in the Git plugin.

To install them into agents that don't load skills over MCP, run the [skills CLI](https://github.com/vercel-labs/skills) with this Drop's address. It asks which skills and which agents, and copies each skill where those agents read it:

```sh
npx skills add $ORIGIN
```

Add `--skill <name>` to install one, such as `--skill pr-evidence`. `npx skills update` brings installed skills up to date.

Agents that discover skills over HTTP find them at `/.well-known/agent-skills/index.json`, which follows [Agent Skills Discovery](https://github.com/cloudflare/agent-skills-discovery-rfc) v0.2.0, and at the older `/.well-known/skills/`. Fetching Drop's home page with `Accept: text/markdown` returns the `vitehub-drop` skill.

Agents that start from the web read `/llms.txt`, an index of everything below, and `/agents.md`, a start guide with this Drop's limits and the skill. Every docs page is also Markdown at its path plus `.md`, such as `/docs/agents.md`.

### Share skills from a folder {#skill-hub}

A **skill hub** is a folder with one subfolder per skill, laid out as the `skill-hub` skill describes. Ask your agent to publish a skill into it, and anyone who can open the folder installs from it.

| Hub's share | Install | Update |
| --- | --- | --- |
| Public link, or Public, anyone comments | `npx skills add <folder link>` | `npx skills update` |
| Only me, Team, or Team can edit | Ask an agent with the `skill-hub` skill | Ask the agent again |

A public hub's link works as a skills CLI source. The **Install** button on the hub's page copies the command, and on a skill's folder it adds `--skill <name>` to install only that skill:

```sh
npx skills add <folder link> --skill release-notes
```

A new version published to the hub reaches `npx skills update` within about a minute. The CLI doesn't sign in, so a private or team hub installs through your agent instead: it downloads the skill over MCP and runs the CLI on the copy. Installing doesn't count as a [visit](/docs/review#expiry), so set the hub's lifetime to Never delete.

If this Drop closes public links after some days (`DROP_PUBLIC_LINK_DAYS`, 7 by default on a team Drop), the hub stops installing when its link closes. Share it public again to reopen it.

## Tools and prompts {#tools}

What the server offers, read from the server itself:

::mcp-tools
::

Every call runs as the person who allowed the client, with their role.

### Handoffs {#handoffs}

**Send** in a drop's review pill hands the comments that wait for an answer to your own agent. Each send is a **handoff**, with an id like `send_3f1c…`.

| Tool | Does |
| --- | --- |
| `list_handoffs` | Your handoffs that no agent finished, newest first: `sent` ones wait, `working` ones an agent opened |
| `read_drop` with `handoff` | Reads the drop with that handoff's threads first, your own as asks and others' as quotes, and shows you Working on the drop's page |

Publish with `agent.session`, its `thread` set to your thread's id (`T3CODE_THREAD_ID` in T3 Code), and with `base`, the version you read. Each delivery names that session, so the next round of comments reaches the thread that wrote the drop, and a stale `base` fails instead of overwriting a newer version. New drops start with the Drop's default share: Team on a team Drop, Only me on a personal one. Agents make a drop public only when you ask, or when it's meant for people outside, like pull request assets.

## Read uploaded files {#read-files}

Your connected agent can read files you upload in the browser, including private files. `read_drop` includes the original image bytes as an MCP image for PNG, JPEG, WebP and GIF. Other image formats arrive as an embedded file resource.

For a PDF, video, or any other binary file, `read_drop` includes an embedded base64 blob resource with the complete original bytes, up to 4 MiB. This also works for clients that still have an older tool catalogue cached. Its `drop-file:` URI identifies the embedded content; it is not a public download link.

To retrieve only a file's bytes, call `read_file` with its drop id or `/d/` link. For one file inside an app, also pass its exact `path` from `read_drop`. `format: "resource"` requests an embedded blob resource for an image too, so a client can save it. Clients may need to refresh their tool catalogue to discover `read_file`.

File reads use the same access checks as opening the drop. They require no browser session or share change. Private files stay private, expired shares stop working, and owners can still read their own Trash until it is permanently deleted. Whether an agent can display an image, parse a PDF, or inspect a video depends on its client's format support.

## Where agents publish {#folders}

Before publishing something new, an agent calls `list_folders`. It lists the folders you can publish into, the team's first, each with its path and the start of its description. With `query`, it lists only the folders whose name, path, or description has those words, each with its whole description. The agent passes the folder whose description fits to `publish` and follows what the description asks, such as how to name the doc. When none fits, it publishes at the top.

So write a folder's description for the agent too: what goes in it, how to name it, and how to lay it out. Agents take descriptions as guidance about where things go, not as instructions for anything else. An agent can describe your own folders with `create_folder` or `update_drop` and `description`; admins describe the team's folders in the browser.

## Code images {#code-images}

`create_code_image` highlights code with Shiki and returns a framed image at a public URL that expires after five minutes. SVG works on every Drop. PNG is a Browser Run screenshot of the SVG, so only Drops on Cloudflare have it, drop.vitehub.dev included. There it's the default. On other hosts the tool renders SVG and says so in its description.

## Protocol {#protocol}

Streamable HTTP at `/mcp`. Drop speaks MCP :mcp-versions{latest} and answers clients on :mcp-versions. The server is [nitro-mcp-toolkit](https://github.com/nuxt-modules/mcp-toolkit), with one file per tool and prompt in `server/mcp/`.
