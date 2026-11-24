import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { addPlugin, createResolver, defineNuxtModule, useLogger } from "@nuxt/kit"
import { buildMetaContent, buildMetaName, readForgeBuild } from "@vite-hub/forge/build/node"

import { canvasManifest } from "./canvas.ts"

import type { Nuxt } from "@nuxt/schema"

import type { CanvasPageMeta } from "./canvas.ts"
import type { DropPublicConfig } from "./runtime/script.ts"

export interface DropModuleOptions {
  url?: string
  edge?: "top" | "right" | "bottom" | "left"
  at?: number
  collapsed?: boolean
  preview?: boolean
}

export type { CanvasPageMeta, DropPublicConfig }

declare module "#app" {
  interface PageMeta {
    canvas?: false | CanvasPageMeta
  }
}

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
    serveCanvasManifest(nuxt)
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

function serveCanvasManifest(nuxt: Nuxt) {
  const dir = join(nuxt.options.buildDir, "drop-canvas")
  rmSync(dir, { recursive: true, force: true })
  nuxt.options.experimental.extraPageMetaExtractionKeys.push("canvas")
  nuxt.options.nitro.publicAssets = [...(nuxt.options.nitro.publicAssets ?? []), { dir, maxAge: 0 }]
  nuxt.hook("pages:resolved", (pages) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "__canvas.json"), JSON.stringify(canvasManifest(pages)))
  })
}

export default dropModule
