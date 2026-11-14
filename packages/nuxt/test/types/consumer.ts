// Compiled against the built declarations, as a site would see them, with Nuxt 4's and Nuxt 5's module types.
import drop from "../../dist/nuxt.mjs"

import type { DropModuleOptions } from "../../dist/nuxt.mjs"
import type { NuxtConfig as Nuxt4Config, NuxtModule as Nuxt4Module } from "@nuxt/schema"
import type { NuxtConfig as Nuxt5Config, NuxtModule as Nuxt5Module } from "nuxt/schema"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

export const nuxt4: Nuxt4Config = { modules: [drop, [drop, { url: "https://drop.example.com" }]] }
export const nuxt5: Nuxt5Config = { modules: [drop, [drop, { url: "https://drop.example.com" }]] }

// Nuxt's generated types/modules.d.ts reads the options of a module this way.
export const nuxt4Options: Equal<typeof drop extends Nuxt4Module<infer O> ? O : never, DropModuleOptions> = true
export const nuxt5Options: Equal<typeof drop extends Nuxt5Module<infer O> ? O : never, DropModuleOptions> = true
