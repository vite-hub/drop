---
name: vitehub-drop
description: Uploads a local file and returns its permanent public URL. Use when an agent needs to include a local image or document in GitHub content like issues, Pull Request, etc...
---

# ViteHub Drop

The input must be a file the user placed in scope. Run:

```sh
curl --fail-with-body --silent --show-error \
  -F "file=@/absolute/path/to/file.pdf" \
  https://drop.vitehub.dev/api/files
```

The command retuns a JSON object with the permanent public URL returned as soon as the file is stored. Never derive or rewrite it from an upload endpoint. Drop optimizes supported images in the background.
