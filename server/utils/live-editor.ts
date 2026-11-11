import { createEditorCodec } from "comark-ui/editor"
import { version as comarkUiVersion } from "comark-ui/package.json"
import { defineCachedFunction } from "nitro/cache"
import { splitFrontmatter } from "#shared/frontmatter"
import { LIVE_EDITOR_KIT } from "#shared/live-editor"
import { MARKDOWN_CACHE_TTL } from "./markdown-cache"
import { renderPlugins } from "./markdown-document"

/**
 * The live room's schema and Markdown codec. It reads a draft with the plugins Drop renders with, and without
 * Comark's defaults, as Drop does, so a bare URL stays text instead of becoming a link a save writes as `<url>`.
 */
export const liveEditor = createEditorCodec({
  plugins: renderPlugins,
  registerDefaultPlugins: false,
  kit: LIVE_EDITOR_KIT,
})

/**
 * Whether the live editor can save this doc without changing what readers see: its body round-trips through the
 * editor to the same tree Drop renders. Front matter stays out of the room. Charts draw while it checks, so the answer
 * is kept by blob key, which never changes.
 */
const keeps = async (markdown: string) => (await liveEditor.verify(splitFrontmatter(markdown).body)).writable

const cached = defineCachedFunction(async (_key: string, markdown: string) => keeps(markdown), {
  name: "live-editable",
  maxAge: MARKDOWN_CACHE_TTL,
  swr: false,
  integrity: comarkUiVersion,
  getKey: (key: string) => key,
})

export const liveEditorKeeps = (key: string | null, markdown: string) => (key ? cached(key, markdown) : keeps(markdown))
