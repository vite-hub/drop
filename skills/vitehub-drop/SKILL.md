---
name: vitehub-drop
description: Uploads a local file and returns its permanent public URL. Use when an agent needs to include a local image or document in GitHub content like issues, Pull Request, etc... It can also render source code as a temporary image URL.
---

# ViteHub Drop

Choose one branch and return its stdout verbatim.

## File

Upload a file placed in scope:

```sh
curl --fail-with-body --silent --show-error \
  -F "file=@/absolute/path/to/file.pdf" \
  https://drop.vitehub.dev/api/files |
  jq -er '.url'
```

## Code

Render code through Ray.so's native export.
```sh
curl --fail-with-body --silent --show-error \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"typescript","theme":"midnight","format":"png","scale":4}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```

Code image URLs expire after five minutes; download and re-upload through File to make one permanent.

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
