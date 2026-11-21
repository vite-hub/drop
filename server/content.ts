import { defineContent } from "vite-hub/content"
import { glob } from "vite-hub/source"

/**
 * The docs at /docs, written in Markdown under content/docs. The build bundles the files into the server, so every
 * host serves them, Workers included, with no file system at runtime.
 *
 * `seo.markdown` answers a page's own URL with its Markdown copy for a request that prefers `text/markdown` or comes
 * from an AI fetcher. The copy is the answer at the page URL plus `.md`: the `/d/**.md` routes for a share link
 * (server/utils/drop-markdown.ts), whose page draws the doc in the browser, and the docs middleware for a docs page
 * (server/middleware/0.08.docs-markdown.ts).
 */
export default defineContent({
  sources: { docs: glob("content/docs/**/*.md") },
  seo: { markdown: true },
})
