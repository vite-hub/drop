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

Render a highlighted code card with Cloudflare Kitesurf.
```sh
curl --fail-with-body --silent --show-error \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"typescript","theme":"midnight","format":"png","scale":4}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```

Code image URLs expire after five minutes; download and re-upload through File to make one permanent.

## Options

- `theme` accepts `breeze`, `candy`, `midnight`, `nuxt`, `raindrop`, or `sunset` without case sensitivity.
- `language` accepts common names such as `javascript`, `typescript`, `python`, `rust`, `go`, `java`, `c`, `c++`, `c#`, `bash`, `html`, `css`, `json`, `yaml`, `sql`, and `markdown`. Unknown names render as plain text.
- `format` accepts `png` (default) or `svg`.
- `scale` accepts `2`, `4` (default), or `6`.
