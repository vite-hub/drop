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

Send source text as JSON. When the user specifies a language or theme, choose its exact value from [code image options](references/code-options.md):

```sh
curl --fail-with-body --silent --show-error \
  -H "content-type: application/json" \
  --data '{"code":"const answer: number = 42","language":"TypeScript","theme":"Midnight","format":"png","scale":4}' \
  https://drop.vitehub.dev/api/code |
  jq -er '.url'
```

Code image URLs are available for five minutes. When a permanent URL is needed, download the exported file within that window and upload it with the File branch.
