---
name: vitehub-drop
description: Publishes local files at permanent public URLs, renders Markdown as readable HTML, and turns source code into temporary images. Use when the user asks to publish a file, share a rendered document, or create a code image.
---

# ViteHub Drop

Publish one file and return its URL. Files cannot be edited through the API, so publish a new file for every revision. PNG, JPEG, and WebP files may replace the original bytes at the same URL with a smaller optimized version.

## Publish a file

Upload a file already in scope:

```sh
curl --fail-with-body --silent --show-error \
  -F "file=@/absolute/path/to/file" \
  https://drop.vitehub.dev/api/files |
  jq -er '.url'
```

Return the command's stdout verbatim. Do not retry a successful upload: every successful request creates another permanent URL.

Markdown files render as HTML at the returned URL. Append `?raw` to read their exact source. Before publishing Markdown, HTML, a prompt, or a `SKILL.md` file, follow [the document guide](references/documents.md).

## Render code

Render code through Ray.so's native export.

```sh
curl --fail-with-body --silent --show-error \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"typescript","theme":"midnight","format":"png","scale":4}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```

Code image URLs expire after five minutes; download and publish the result to make it permanent.

## Options

- `language` accepts a case-sensitive Ray.so ID such as `cpp` or `typescript`. Omit it when plain text is enough.
- `theme` accepts a case-sensitive Ray.so ID such as `nuxt` or `midnight`.
- `format` accepts `png` (default) or `svg`.
- `scale` for png accepts `2`, `4` (default), or `6`.
