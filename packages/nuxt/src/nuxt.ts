import { addPlugin, createResolver, defineNuxtModule, useLogger } from "@nuxt/kit"
import { buildMetaContent, buildMetaName, readForgeBuild } from "@vite-hub/forge/build/node"

import type { DropPublicConfig } from "./runtime/script.ts"

export interface DropModuleOptions {
  url?: string
  edge?: "top" | "right" | "bottom" | "left"
  at?: number
  collapsed?: boolean
  preview?: boolean
}

export type { DropPublicConfig }

type DropModuleSetupResult = false | void | { timings?: { setup?: number; [key: string]: number | undefined } }

export type DropNuxtModule = {
  setup(
    this: void,
    resolvedOptions: DropModuleOptions,
    nuxt: unknown,
  ): DropModuleSetupResult | Promise<DropModuleSetupResult>
}["setup"]

const dropModule: DropNuxtModule = defineNuxtModule<DropModuleOptions>({
  meta: { name: "@vite-hub/drop", configKey: "drop", compatibility: { nuxt: ">=4.0.0" } },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    // SAFETY: only this module and NUXT_PUBLIC_DROP_* write `public.drop`, and every field is checked before use.
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
