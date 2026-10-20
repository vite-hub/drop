import { Extension } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { stringifyTokenStyle } from "shiki/core"
import { type CodeLanguage, codeLanguage, loadHighlighter } from "#shared/highlighter"

type Highlighter = Awaited<ReturnType<typeof loadHighlighter>>["shiki"]

const key = new PluginKey<DecorationSet>("codeHighlight")
const THEMES = { light: "github-light", dark: "github-dark" } as const

let highlighter: Highlighter | undefined
const loaded = new Set<CodeLanguage>()
const loading = new Set<CodeLanguage>()

// A grammar that fails to load stays in `loading`: its blocks stay plain rather than retry on every keystroke.
async function prepare(lang: CodeLanguage) {
  try {
    highlighter = (await loadHighlighter(lang, [THEMES.light, THEMES.dark])).shiki
    loaded.add(lang)
    loading.delete(lang)
  } catch {}
}

function decorate(doc: ProseMirrorNode): DecorationSet {
  if (!highlighter) return DecorationSet.empty
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return
    const lang = codeLanguage(node.attrs.language)
    if (lang && loaded.has(lang))
      for (const line of highlighter!.codeToTokens(node.textContent, { lang, themes: THEMES }).tokens)
        for (const token of line) {
          const style = stringifyTokenStyle(token.htmlStyle ?? {})
          const from = pos + 1 + token.offset
          if (style)
            decorations.push(Decoration.inline(from, from + token.content.length, { class: "shiki-token", style }))
        }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * The live editor's code blocks in the same Shiki colors as the rendered doc (server/utils/markdown-document.ts), as
 * decorations, so the text and its Markdown stay plain. A language loads the first time a block uses it.
 */
export const CodeHighlight = Extension.create({
  name: "codeHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => decorate(doc),
          apply: (tr, previous) => (tr.docChanged || tr.getMeta(key) ? decorate(tr.doc) : previous),
        },
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          const load = () =>
            view.state.doc.descendants((node) => {
              if (node.type.name !== "codeBlock") return
              const lang = codeLanguage(node.attrs.language)
              if (lang && !loaded.has(lang) && !loading.has(lang)) {
                loading.add(lang)
                void prepare(lang).then(() => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(key, true)))
              }
              return false
            })
          load()
          return { update: load }
        },
      }),
    ]
  },
})
