---
name: vitehub-drop
description: Uploads a local image and returns its permanent public URL. Use when an agent needs to include a local image in GitHub content.
---

# ViteHub Drop

The input must be an image the user placed in scope. Resolve the bundled script relative to this `SKILL.md`, then run:

```sh
node "<skill-directory>/scripts/upload-image.mjs" "/absolute/path/to/image.png"
```

The script prints a permanent `https://drop.vitehub.dev/i/<id>` URL as soon as Blob stores the original. Drop optimizes the image in the background. Use the URL in GitHub content the user explicitly authorized.
