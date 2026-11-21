import { defineNuxtPlugin, onNuxtReady, useRuntimeConfig } from "#app"

import { reviewScript } from "./script.ts"

import type { DropPublicConfig } from "./script.ts"

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
