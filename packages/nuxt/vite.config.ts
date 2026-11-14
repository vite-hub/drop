import { defineConfig } from "vite-plus"

export default defineConfig({
  pack: {
    entry: ["src/nuxt.ts", "src/runtime/review.client.ts"],
    dts: true,
    // `@vite-hub/forge/build/node` is bundled, so a site needs no ViteHub package.
    deps: {
      alwaysBundle: [/^@vite-hub\/forge/],
      onlyBundle: false,
      neverBundle: [/^#app$/, /^nuxt(?:\/|$)/, /^@nuxt\//],
    },
  },
})
