---
name: vitehub-drop
description: Use Drop for local file uploads or source-code screenshots with permanent URLs.
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

Send source text as JSON. Add a case-sensitive Ray.so language or theme when specified:

```sh
curl --fail-with-body --silent --show-error \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"TypeScript","theme":"Midnight"}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```
