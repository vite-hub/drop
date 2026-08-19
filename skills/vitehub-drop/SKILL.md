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

Render code with Drop's built-in highlighter and Kitesurf renderer.
```sh
curl --fail-with-body --silent --show-error \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"typescript","theme":"midnight","format":"png","scale":4}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```

Code image URLs expire after five minutes; download and re-upload through File to make one permanent.

## Options

- `language` is case-insensitive and falls back to plain text when unsupported.
- `theme` accepts `midnight` (default), `breeze`, `candy`, `nuxt`, `raindrop`, or `sunset`.
- `format` accepts `png` (default) or `svg`.
- `scale` accepts `2`, `4` (default), or `6`.
