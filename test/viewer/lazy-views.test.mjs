import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "vite-plus/test"

// Nuxt imports a component the template names as is into the page's chunk, and only `Lazy<Name>` loads on first render.
// A doc reader never sees these views, so naming one without `Lazy` puts it back on every doc page (~22 KB gzip).
const VIEWS = [
  "ViewerBoard",
  "ViewerDiff",
  "ViewerEditNote",
  "ViewerEditor",
  "ViewerFolder",
  "ViewerGallery",
  "ViewerHistory",
  "ViewerLightbox",
  "ViewerMarkTools",
  "ViewerSite",
  "ViewerVariants",
  "ViewerVideo",
]

test("the drop viewer loads the views a doc doesn't use only when it shows them", () => {
  const source = readFileSync(new URL("../../app/components/DropViewer.vue", import.meta.url), "utf8")
  for (const view of VIEWS) {
    assert.match(source, new RegExp(`<Lazy${view}\\b`), `${view} is shown lazily`)
    assert.doesNotMatch(source, new RegExp(`<${view}\\b`), `${view} isn't imported with the page`)
  }
})
