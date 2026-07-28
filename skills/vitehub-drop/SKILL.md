---
name: vitehub-drop
description: Upload a local file or render source code as an image and return its permanent public URL. Use when an agent needs a durable image, document, or code screenshot for GitHub, social media, or other external content.
---

# ViteHub Drop

Choose the entry point from the input.

## Upload a file

Use only a file the user placed in scope. Run:

```sh
curl --fail-with-body --silent --show-error \
  -F "file=@/absolute/path/to/file.pdf" \
  https://drop.vitehub.dev/api/files |
  jq -er '.url'
```

Drop stores other files unchanged and optimizes supported images in the background.

## Render code

Send source text as JSON. Add a case-sensitive Ray.so language or theme only when the user specifies it.

```sh
curl --fail-with-body --silent --show-error \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"TypeScript","theme":"Midnight"}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```

Copy stdout verbatim. Never derive or rewrite the permanent URL from an upload endpoint, Blob key, or framework route.
