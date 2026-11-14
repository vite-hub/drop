import { defineNuxtPlugin, onNuxtReady, useRuntimeConfig } from "#app"

import { reviewScript } from "./script.ts"

import type { DropPublicConfig } from "./script.ts"

// Runs in the browser, so a deployment turns review.js on or off with NUXT_PUBLIC_DROP_URL, prerendered pages included.
export default defineNuxtPlugin(() => {
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
