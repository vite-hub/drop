import { useRuntimeConfig } from "nitro/runtime-config"
import { defineSitemap } from "vite-hub/seo"
import { INDEXED_PATHS } from "#shared/utils/docs"

export default defineSitemap(() => (useRuntimeConfig().seoIndex ? INDEXED_PATHS.map((loc) => ({ loc })) : []))
