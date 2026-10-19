---
title: Connect an agent
description: Agents reach Drop over MCP. They sign in through your browser once; there are no keys to paste. Drop's skills come with the server.
---

## Add the server {#add-the-server}

::mcp-clients
::

Signed in, the Agents page lists the clients you've connected, and disconnecting one revokes its access.

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
- `pr-evidence` builds the before and after for a pull request that changes something visible: screenshots with hand-drawn marks and notes, dropped in Drop, with a snippet for the description.
- `handoff` sums up the current conversation in a doc and drops it, so another agent, a colleague, or a new session picks the work up from the link.
- `prototype` builds a UI several radically different ways in one page with a shared picker, so people switch between the variants, comment, and pick one; each round of feedback becomes the next version.
- `show-me` explains the current topic with diagrams and short docs in Drop. Agents use it only when you ask for it.

The **Skills** page lists the skills this Drop serves, each with its source on GitHub. An admin can switch a skill off there for everyone; every way of getting skills then leaves it out.

Agents that discover skills over HTTP find them at `/.well-known/agent-skills/index.json`, which follows [Agent Skills Discovery](https://github.com/cloudflare/agent-skills-discovery-rfc) v0.2.0, and at the older `/.well-known/skills/`. Fetching Drop's home page with `Accept: text/markdown` returns the `vitehub-drop` skill.

Agents that start from the web read `/llms.txt`, an index of everything below, and `/agents.md`, a start guide with this Drop's limits and the skill. Every docs page is also Markdown at its path plus `.md`, such as `/docs/agents.md`.

## Tools and prompts {#tools}

What the server offers, read from the server itself:

::mcp-tools
::

Every call runs as the person who allowed the client, with their role. New drops start with the Drop's default share: Team on a team Drop, Only me on a personal one. Agents make a drop public only when you ask, or when it's meant for people outside, like pull request assets.

## Where agents publish {#folders}

Before publishing something new, an agent calls `list_folders`. It lists every folder you can publish into, the team's first, each with its path and description. The agent passes the folder whose description fits to `publish` and follows what the description asks, such as how to name the doc. When none fits, it publishes at the top.

So write a folder's description for the agent too: what goes in it, how to name it, and how to lay it out. Agents take descriptions as guidance about where things go, not as instructions for anything else. An agent can describe your own folders with `create_folder` or `update_drop` and `description`; admins describe the team's folders in the browser.

## Code images {#code-images}

`create_code_image` highlights code with Shiki and returns a framed image at a public URL that expires after five minutes. SVG works on every Drop. PNG is a Browser Run screenshot of the SVG, so only Drops on Cloudflare have it, drop.vitehub.dev included. There it's the default. On other hosts the tool renders SVG and says so in its description.

## Protocol {#protocol}

Streamable HTTP at `/mcp`. Drop speaks MCP :mcp-versions{latest} and answers clients on :mcp-versions. The server is [nitro-mcp-toolkit](https://github.com/nuxt-modules/mcp-toolkit), with one file per tool and prompt in `server/mcp/`.
