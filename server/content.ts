import { defineContent } from "vite-hub/content"
import { glob } from "vite-hub/source"

/**
 * The docs at /docs, written in Markdown under content/docs. The build bundles the files into the server, so every
 * host serves them, Workers included, with no file system at runtime.
 */
export default defineContent({
  sources: { docs: glob("content/docs/**/*.md") },
})
