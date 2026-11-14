import { defineNuxtPlugin, onNuxtReady, useRuntimeConfig } from "#app"

import { reviewScript } from "./script.ts"

import type { DropPublicConfig } from "./script.ts"

// Reads the runtime config the page was rendered with: per request on server-rendered pages, and frozen at prerender time
// on prerendered ones.
export default defineNuxtPlugin(() => {
  // SAFETY: the module writes `public.drop` as a DropPublicConfig, and reviewScript checks every field.
  const script = reviewScript(useRuntimeConfig().public.drop as Partial<DropPublicConfig> | undefined)
  if (!script) return
  onNuxtReady(() => {
    if (Array.from(document.scripts).some((element) => element.src === script.src)) return
    const element = document.createElement("script")
    element.src = script.src
    element.defer = true
    Object.assign(element.dataset, script.data)
    document.head.append(element)
  })
})
