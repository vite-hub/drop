import { addTemplate, defineNuxtModule } from "nuxt/kit"
import type { NodeHandler } from "@comark/html/render"
import comarkUi from "comark-ui/html"

/**
 * comark-comments' stylesheet, which the frame's comment layer draws review comments with (ANNOTATOR_SCRIPT in
 * shared/plan-runtime.ts), so they look like a doc's own threads. The package writes it only with the root it wraps a
 * doc in, so this renders an empty root once, at build time: the app doesn't bundle the renderer or its fonts.
 */
async function loadCommentsCss() {
  const root = comarkUi().components.comments!
  // SAFETY: the root handler reads only `context`, to write its styles once, and `flow`, for the doc it wraps.
  const state = { context: {}, flow: async () => "" } as unknown as Parameters<NodeHandler>[1]
  const html = await root(["comments", {}], state)
  const css = html.match(/<style data-comark-comments>([\s\S]*?)<\/style>/)?.[1]
  if (!css) throw new Error("comark-comments wrote no stylesheet with its root")
  return css
}

export default defineNuxtModule({
  meta: { name: "drop-comark-comments-css" },
  async setup(_options, nuxt) {
    const css = await loadCommentsCss()
    const template = addTemplate({
      filename: "comark-comments-css.ts",
      write: true,
      getContents: () => `export default ${JSON.stringify(css)}\n`,
    })
    nuxt.options.alias["#comark-comments-css"] = template.dst
  },
})
