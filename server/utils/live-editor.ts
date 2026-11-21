import { createEditorCodec } from "comark-ui/editor"
import { version as comarkUiVersion } from "comark-ui/package.json"
import { defineCachedFunction } from "nitro/cache"
import { splitFrontmatter } from "#shared/frontmatter"
import { LIVE_EDITOR_KIT } from "#shared/live-editor"
import { MARKDOWN_CACHE_TTL } from "./markdown-cache"
import { renderPlugins } from "./markdown-document"

export const liveEditor = createEditorCodec({
  plugins: renderPlugins,
  registerDefaultPlugins: false,
  kit: LIVE_EDITOR_KIT,
})

const keeps = async (markdown: string) => (await liveEditor.verify(splitFrontmatter(markdown).body)).writable

const cached = defineCachedFunction(async (_key: string, markdown: string) => keeps(markdown), {
  name: "live-editable",
  maxAge: MARKDOWN_CACHE_TTL,
  swr: false,
  integrity: comarkUiVersion,
  getKey: (key: string) => key,
})

export const liveEditorKeeps = (key: string | null, markdown: string) => (key ? cached(key, markdown) : keeps(markdown))
