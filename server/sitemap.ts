import { useRuntimeConfig } from "nitro/runtime-config"
import { defineSitemap } from "vite-hub/seo"
import { INDEXED_PATHS } from "#shared/utils/docs"

/** The pages search engines may index (INDEXED_PATHS), on whichever host serves this Drop. None while indexing is off. */
export default defineSitemap(() => (useRuntimeConfig().seoIndex ? INDEXED_PATHS.map((loc) => ({ loc })) : []))
