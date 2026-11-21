import { defineContent } from "vite-hub/content"
import { glob } from "vite-hub/source"

export default defineContent({
  sources: { docs: glob("content/docs/**/*.md") },
  seo: { markdown: true },
})
