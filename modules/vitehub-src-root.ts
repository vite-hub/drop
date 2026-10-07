import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs"
import { join, relative } from "node:path"
import { defineNuxtModule } from "nuxt/kit"

/**
 * Some ViteHub integrations (Rate Limit, Auth types) write generated files under Vite's root, which in Nuxt is
 * `app/`, while Nitro and the tsconfig read them from the project root. A clean checkout (CI, Workers Builds)
 * then can't resolve them. Point `app/.vitehub` at `.vitehub` so both roots see the same files, until ViteHub
 * resolves everything from the project root.
 */
export default defineNuxtModule({
  meta: { name: "drop:vitehub-src-root" },
  setup(_, nuxt) {
    const projectDir = join(nuxt.options.rootDir, ".vitehub")
    const srcDir = join(nuxt.options.srcDir, ".vitehub")
    if (srcDir === projectDir) return
    mkdirSync(projectDir, { recursive: true })
    const stat = existsSync(srcDir) || isLink(srcDir) ? lstatSync(srcDir) : null
    if (stat?.isSymbolicLink()) return
    if (stat) {
      // An earlier run wrote real files here; keep them, then replace the folder with the link.
      cpSync(srcDir, projectDir, { recursive: true, force: false })
      rmSync(srcDir, { recursive: true, force: true })
    }
    symlinkSync(relative(nuxt.options.srcDir, projectDir), srcDir, "dir")
  },
})

function isLink(path: string) {
  try {
    return lstatSync(path).isSymbolicLink()
  }
  catch {
    return false
  }
}
