---
name: vitehub-drop
description: Drops plans, docs, and small static apps into Drop for review, reads the comments people leave, and publishes the next version. Also turns source code into temporary images. Use when the user asks to share a plan or document for review, publish a file or a small app, read review feedback, or create a code image.
---

# ViteHub Drop

Drop keeps what you publish private until the user shares it. People comment on the exact spot; you read the open comments and drop the next version.

Every request needs the user's API key in `DROP_API_KEY`. If it's unset, ask the user to create one at `https://drop.vitehub.dev/agents` (name it after yourself, like "Claude Code") and export it. Drop also speaks MCP at `https://drop.vitehub.dev/mcp` with the same key as a bearer token; prefer it when your client has it registered.

## Drop a file

```sh
curl --fail-with-body --silent --show-error \
  -H "x-api-key: $DROP_API_KEY" \
  -F "file=@/absolute/path/to/plan.md" \
  https://drop.vitehub.dev/api/files |
  jq -er '.page'
```

The response is `{ id, url, page, visibility, version }`:

- `page` is where people review it. Give the user this link.
- `url` serves the file itself at `/f/<key>`. Markdown and HTML render there; append `?raw` for the exact source.
- New drops are `private`. Only the user can open them until they share them.

Do not retry a successful upload: every success creates another drop. Before publishing Markdown, HTML, a prompt, or a `SKILL.md` file, follow [the document guide](references/documents.md).

## Publish the next version

Add `supersedes` with the id of the drop it replaces, as a form field (`-F "supersedes=<id>"`) or in the front matter (`supersedes: <id>`). The new version keeps the old one's sharing, and the old one stays in history.

## Read feedback

```sh
curl --fail-with-body --silent --show-error \
  -H "x-api-key: $DROP_API_KEY" \
  https://drop.vitehub.dev/api/drops/<id>/comments |
  jq -r '.[] | select(.resolved | not) | "\(.n). \(.quote // .selector): \(.body)"'
```

Address the open comments, then publish the next version.

## Publish an app

A small static app is a set of files keyed by path, with an `index.html`. Pass `id` to publish its next version.

```sh
curl --fail-with-body --silent --show-error \
  -H "x-api-key: $DROP_API_KEY" -H "content-type: application/json" \
  --data '{"name":"Launch board","files":{"index.html":"<h1>Hi</h1><script type=\"module\" src=\"app.js\"></script>","app.js":"console.log(1)"}}' \
  https://drop.vitehub.dev/api/apps |
  jq -er '.page'
```

## Render code

Drop highlights the code with Shiki and returns it as a framed PNG or SVG.

```sh
curl --fail-with-body --silent --show-error \
  -H "x-api-key: $DROP_API_KEY" -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"typescript","theme":"github-dark","format":"png","scale":4}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```

Code image URLs are public and expire after five minutes; download and drop the result to keep it.

- `language`: `typescript`, `javascript`, `tsx`, `vue`, `python`, `go`, `rust`, `bash`, `json`, `yaml`, `sql`, `css`, `html`, `markdown`, `diff`, and other common ones (aliases like `ts`, `py`, `sh` work). Omit it for plain text.
- `theme`: `github-dark` (default), `github-light`, `vitesse-dark`, `vitesse-light`, `one-dark-pro`, `night-owl`, `tokyo-night`, `dracula`, `nord`, `catppuccin-mocha`.
- `format` accepts `png` (default) or `svg`.
- `scale` for png accepts `2`, `4` (default), or `6`.
