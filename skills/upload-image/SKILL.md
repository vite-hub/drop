---
name: upload-image
description: Uploads a local image and returns its permanent public URL. Use when an agent needs to include a local image in GitHub content.
---

# Upload Image to GitHub

The input must be an image the user placed in scope. Resolve the bundled script relative to this `SKILL.md`, then run:

```sh
node "<skill-directory>/scripts/upload-image.mjs" "/absolute/path/to/image.png"
```

The script waits for background optimization. The upload is complete when it prints a permanent `https://drop.vitehub.dev/i/<id>` URL. Use that URL in GitHub content the user explicitly authorized.
