import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { defineNuxtModule } from "nuxt/kit"

/**
 * ViteHub's Rate Limit integration writes its Nitro plugin under Vite's root, which in Nuxt is `app/`, but
 * registers it under the project root. A clean checkout (CI, Workers Builds) then can't resolve the plugin.
 * Link the project-root path to where the file is written until ViteHub resolves both from the same root.
 */
export default defineNuxtModule({
  meta: { name: "drop:vitehub-rate-limit-link" },
  setup(_, nuxt) {
    const written = join(nuxt.options.srcDir, ".vitehub/nitro/rate-limit")
    const expected = join(nuxt.options.rootDir, ".vitehub/nitro/rate-limit")
    if (written === expected) return
    mkdirSync(written, { recursive: true })
    mkdirSync(dirname(expected), { recursive: true })
    const exists = existsSync(expected) || (() => {
      try {
        return lstatSync(expected).isSymbolicLink()
      }
      catch {
        return false
      }
    })()
    if (!exists) symlinkSync(relative(dirname(expected), written), expected, "dir")
  },
})
