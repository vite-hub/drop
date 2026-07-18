---
name: upload-image
description: Uploads a local image and returns a GitHub-renderable URL. Use when an agent needs to include a local image in GitHub content.
---

# Upload Image to GitHub

The input must be an image the user placed in scope. Resolve the bundled script relative to this `SKILL.md`, then run:

```sh
node "<skill-directory>/scripts/upload-image.mjs" "/absolute/path/to/image.png"
```

The upload is complete when the command prints a `https://camo.githubusercontent.com/<id>` URL. Use that URL in GitHub content the user explicitly authorized.
