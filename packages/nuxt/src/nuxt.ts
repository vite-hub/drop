import { addPlugin, createResolver, defineNuxtModule, useLogger } from "@nuxt/kit"
import { buildMetaContent, buildMetaName, readForgeBuild } from "@vite-hub/forge/build/node"

import type { DropPublicConfig } from "./runtime/script.ts"

export interface DropModuleOptions {
  /** Drop's address, such as `https://drop.example.com`. `NUXT_PUBLIC_DROP_URL` sets it at runtime. Empty: no review.js. */
  url?: string
  /** The edge review.js's toolbar starts on. `NUXT_PUBLIC_DROP_EDGE` sets it at runtime. */
  edge?: "top" | "right" | "bottom" | "left"
  /** The place along that edge, from 0 to 100. `NUXT_PUBLIC_DROP_AT` sets it at runtime. */
  at?: number
  /** The toolbar starts as the small mark. `NUXT_PUBLIC_DROP_COLLAPSED` sets it at runtime. */
  collapsed?: boolean
  /**
   * Mark this build as a preview: the page names its repository and commit in `<meta name="vitehub:build">`, so Drop
   * can find the pull request. Set it only in preview builds. Default: `DROP_PREVIEW=1` when the build runs.
   */
  preview?: boolean
}

export type { DropPublicConfig }

// A method signature keeps the module callable by Nuxt 4 and Nuxt 5, whose `Nuxt` types differ, without naming either.
export type DropNuxtModule = { setup(inlineOptions: DropModuleOptions, nuxt: object): unknown }["setup"] & {
  getMeta?: () => Promise<Record<string, unknown>>
}

const dropModule: DropNuxtModule = defineNuxtModule<DropModuleOptions>({
  meta: { name: "@vite-hub/drop", configKey: "drop", compatibility: { nuxt: ">=4.0.0" } },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const current = nuxt.options.runtimeConfig.public.drop as Partial<DropPublicConfig> | undefined
    const drop: DropPublicConfig = {
      url: current?.url ?? options.url ?? "",
      edge: current?.edge ?? options.edge ?? "",
      at: current?.at ?? options.at ?? -1,
      collapsed: current?.collapsed ?? options.collapsed ?? false,
    }
    nuxt.options.runtimeConfig.public.drop = drop
    addPlugin({ src: resolver.resolve("./runtime/review.client"), mode: "client" })

    if (!(options.preview ?? process.env.DROP_PREVIEW === "1")) return
    const content = buildMetaContent(await readForgeBuild(nuxt.options.rootDir))
    if (!content) {
      useLogger("@vite-hub/drop").warn(
        "This preview build has no repository and commit, so Drop cannot link it to a pull request. Set VITEHUB_BUILD_REPOSITORY and VITEHUB_BUILD_COMMIT.",
      )
      return
    }
    nuxt.options.app.head.meta = [...(nuxt.options.app.head.meta ?? []), { name: buildMetaName, content }]
  },
})

export default dropModule
