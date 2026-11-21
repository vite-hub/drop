import { defineConfig } from "vite-plus"

export default defineConfig({
  pack: {
    entry: ["src/nuxt.ts", "src/runtime/review.client.ts"],
    dts: true,
    deps: {
      alwaysBundle: [/^@vite-hub\/forge/],
      onlyBundle: false,
      neverBundle: [/^#app$/, /^nuxt(?:\/|$)/, /^@nuxt\//],
    },
  },
})
