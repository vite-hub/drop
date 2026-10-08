---
name: vitehub-drop
description: Drops plans, docs, and small static apps into Drop for review, reads the comments people leave, and publishes the next version. Also turns source code into temporary images. Use when the user asks to share a plan or document for review, publish a small app, read review feedback, or create a code image.
---

# ViteHub Drop

Drop keeps what you publish private until the user shares it. People comment on the exact spot; you read the open comments and drop the next version.

You work through Drop's MCP server at `https://drop.vitehub.dev/mcp`. There is no key to ask for: the user approved your MCP client once in the browser, and its tools act as them. If the Drop tools (`create_doc`, `list_drops`, …) aren't available, ask the user to add the server, for example `claude mcp add --transport http --scope user drop https://drop.vitehub.dev/mcp`, and sign in when the client asks.

## Drop a doc

Call `create_doc` with the Markdown in `markdown` (or a self-contained HTML page with `format: "html"`). It answers with the review page link; give the user that link. New drops are private until the user shares them.

Do not repeat a successful call: every success creates another drop. Before publishing Markdown, HTML, a prompt, or a `SKILL.md` file, follow [the document guide](references/documents.md).

## Publish the next version

Call `create_doc` again with `supersedes` set to the previous drop's id (or put `supersedes: <id>` in the front matter). The new version keeps the old one's sharing, and the old one stays in history. Any id from the chain works: the new version always lands on top of the latest. If someone else publishes at the same moment, the call fails with a conflict; read the latest version with `read_drop` and publish again. Docs are limited to 4 MiB.

## Read feedback

`list_comments` returns the open comments on a drop, each with the text or spot it quotes. `read_drop` returns the current content. The `address_feedback` prompt chains both. Address the open comments, then publish the next version.

## Publish an app

A small static app is a set of files keyed by path, with an `index.html`. Call `publish_app` with `files` (and `name`); pass `id` to publish its next version. Publishing replaces the entire file set and deletes the old files. Only the latest app version is kept; include every file the app still needs in each publish. Doc version history does not apply to apps. Relative links, ES modules, and `fetch("data.json")` work like on any static host.

## Render code

`create_code_image` highlights code with Shiki and returns a framed PNG or SVG. The URL is public and expires after five minutes; download it, or drop it to keep it.

- `language`: `typescript`, `javascript`, `tsx`, `vue`, `python`, `go`, `rust`, `bash`, `json`, `yaml`, `sql`, `css`, `html`, `markdown`, `diff`, and other common ones (aliases like `ts`, `py`, `sh` work). Omit it for plain text.
- `theme`: `github-dark` (default), `github-light`, `vitesse-dark`, `vitesse-light`, `one-dark-pro`, `night-owl`, `tokyo-night`, `dracula`, `nord`, `catppuccin-mocha`.
- `format` accepts `png` or `svg`. PNG is the default on Drops that run on Cloudflare, like drop.vitehub.dev; Drops on other hosts render SVG only, and the tool description says which.
- `scale` for png accepts `2`, `4` (default), or `6`.
