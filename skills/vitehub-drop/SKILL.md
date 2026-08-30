---
name: vitehub-drop
description: Publishes local files at permanent public URLs, with readable HTML rendering for Markdown and temporary image rendering for source code. Use when attaching files to GitHub issues or pull requests.
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

Markdown files render as HTML at the returned URL. Append `?raw` to read their exact source. Before publishing a human-readable Markdown or HTML file, follow [the document guide](references/documents.md).

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

Fetch the current case-sensitive IDs directly from Ray.so before setting `language` or `theme`:

```bash
# Fetch and parse available themes
curl -s "https://raw.githubusercontent.com/raycast/ray-so/main/app/(navigation)/(code)/store/themes.ts" | grep -oE 'id:[[:space:]]*"[^"]+"' | sed -E 's/id:[[:space:]]*"([^"]+)"/\1/' | sort -u

# Fetch and parse available languages
curl -s "https://raw.githubusercontent.com/raycast/ray-so/main/app/(navigation)/(code)/util/languages.ts" | grep -oE '^[[:space:]]*"?[a-zA-Z0-9+#-]+"?[[:space:]]*:[[:space:]]*\{' | sed -E 's/^[[:space:]]*"?([^"]+)"?[[:space:]]*:.*/\1/' | sort -u
```

- `language` and `theme` accept the IDs printed by those commands.
- `format` accepts `png` (default) or `svg`.
- `scale` for png accepts `2`, `4` (default), or `6`.
