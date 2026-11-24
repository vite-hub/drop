import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { addPlugin, addTypeTemplate, createResolver, defineNuxtModule, useLogger } from "@nuxt/kit"
import { buildMetaContent, buildMetaName, readForgeBuild } from "@vite-hub/forge/build/node"

import { canvasManifest, canvasPageURL, canvasRouteOwner, routeRuleRedirects } from "./canvas.ts"

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
    addTypeTemplate({
      filename: "types/drop-canvas.d.ts",
      getContents: () =>
        [
          'declare module "nuxt/app" {',
          "  interface PageMeta {",
          "    canvas?: false | { params?: Record<string, string> }",
          "  }",
          "}",
          "export {}",
        ].join("\n"),
    })

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

function prerenderKey(path: string): string {
  return path.replace(/\/$/, "") || "/"
}

function serveCanvasManifest(nuxt: Nuxt) {
  const dir = join(nuxt.options.buildDir, "drop-canvas")
  const filename = "__canvas.json"
  const keys = nuxt.options.experimental.extraPageMetaExtractionKeys
  if (!keys.includes("canvas")) keys.push("canvas")
  if (nuxt.options.experimental.scanPageMeta === false) {
    useLogger("@vite-hub/drop").warn(
      "Page meta scanning is disabled. The canvas manifest cannot read canvas options from definePageMeta.",
    )
  }
  rmSync(dir, { recursive: true, force: true })
  nuxt.options.nitro.publicAssets = [...(nuxt.options.nitro.publicAssets ?? []), { dir, maxAge: 0 }]

  const writeManifest = (
    output: string,
    routes: Parameters<typeof canvasManifest>[0],
    include: (url: string | undefined, route: (typeof routes)[number]) => boolean,
  ) => {
    if (!routes.length) {
      rmSync(join(output, filename), { force: true })
      return
    }
    const manifest = canvasManifest(routes, (page, route) => include(canvasPageURL(page), route))
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, filename), JSON.stringify(manifest))
  }

  if (nuxt.options.dev) {
    nuxt.hook("app:templatesGenerated", (app) => {
      writeManifest(dir, app.pages ?? [], (url) => !url || !routeRuleRedirects(nuxt.options.routeRules, url))
    })
    return
  }

  nuxt.hook("nitro:build:before", (nitro) => {
    const routes = nuxt.apps.default?.pages ?? []
    const redirects = (url: string) => {
      const rules = nitro.routing?.routeRules
      if (!rules?.matchAll) return routeRuleRedirects(nitro.options.routeRules, url)
      const base = (nitro.options.baseURL ?? "/").replace(/\/$/, "")
      const matches: { redirect?: unknown }[] = rules.matchAll("GET", `${base}${url}`)
      return matches.some((rule) => rule.redirect)
    }
    if (!nitro.options.static) {
      writeManifest(dir, routes, (url) => !url || !redirects(url))
      return
    }
    nitro.hooks.hook(
      "prerender:done",
      ({ prerenderedRoutes }: { prerenderedRoutes: { route: string; fileName?: string; contentType?: string }[] }) => {
        const rendered = new Set(
          prerenderedRoutes
            .filter(
              (entry) =>
                entry.fileName?.endsWith(".html") && (!entry.contentType || entry.contentType.includes("text/html")),
            )
            .map((entry) => prerenderKey(entry.route)),
        )
        const owner = routes.length ? canvasRouteOwner(nuxt.options.rootDir, routes) : undefined
        writeManifest(nitro.options.output.publicDir, routes, (url, route) =>
          Boolean(url && rendered.has(prerenderKey(decodeURI(url))) && owner?.(url) === route && !redirects(url)),
        )
      },
    )
  })
}

export default dropModule
