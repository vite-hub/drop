import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { expect, it } from "vitest"

const exec = promisify(execFile)
const packageDir = fileURLToPath(new URL("..", import.meta.url))
const nuxtCLI = fileURLToPath(new URL("./bin/nuxt.mjs", import.meta.resolve("nuxt/package.json")))

async function buildFixture(
  mode: "build" | "generate",
  options: { scan: boolean; pages?: boolean },
  verify: (readOutput: (path: string) => Promise<string>) => Promise<void>,
) {
  const root = await mkdtemp(join(packageDir, ".canvas-build-"))
  const write = async (path: string, content: string) => {
    const file = join(root, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  try {
    await write(
      "nuxt.config.ts",
      `export default defineNuxtConfig({
      modules: [${JSON.stringify(join(packageDir, "src/nuxt.ts"))}],
      drop: { preview: true },
      pages: true,
      app: { baseURL: "/preview/" },
      experimental: { scanPageMeta: ${options.scan ? '"after-resolve"' : "false"}, typedPages: false },
      routeRules: { "/legacy": { redirect: "/" }, "/moved": { redirect: "/" } },
      ${mode === "generate" ? 'nitro: { prerender: { routes: ["/blog", "/items/43/"] } },' : ""}
    })`,
    )
    const page = "<template><div>Fixture page</div></template>"
    if (options.pages !== false) {
      await write("app/pages/index.vue", page)
      await write("app/pages/blog/[[slug]].vue", page)
      await write("app/pages/legacy.vue", page)
      await write("app/pages/docs/[...slug]/edit.vue", page)
      await write(
        "app/pages/orders/[id].vue",
        `<script setup>definePageMeta({ canvas: { params: { id: '42' } } })</script>${page}`,
      )
      await write(
        "app/pages/items/[id].vue",
        `<script setup>definePageMeta({ canvas: { params: { id: '43' } } })</script>${page}`,
      )
    } else {
      await write("app/app.vue", page)
      await write(
        "nuxt.config.ts",
        `export default defineNuxtConfig({
        modules: [${JSON.stringify(join(packageDir, "src/nuxt.ts"))}], drop: { preview: true }, pages: true,
      })`,
      )
    }
    await exec(process.execPath, [nuxtCLI, mode, root], { cwd: packageDir })
    await verify((path) => readFile(join(root, ".output/public", path), "utf8"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it("builds an SSR manifest without scanning and omits actual route-rule redirects", async () => {
  await buildFixture("build", { scan: false }, async (read) => {
    const { pages } = JSON.parse(await read("__canvas.json"))
    expect(pages.map((page: { path: string }) => page.path).sort()).toEqual([
      "/",
      "/blog/:slug?",
      "/items/:id",
      "/orders/:id",
    ])
  })
}, 30_000)

it("does not publish a manifest for an empty pages app", async () => {
  await buildFixture("build", { scan: true, pages: false }, async (read) => {
    await expect(read("__canvas.json")).rejects.toMatchObject({ code: "ENOENT" })
  })
}, 30_000)

it("publishes only generated static targets, with no fallback required", async () => {
  await buildFixture("generate", { scan: true }, async (read) => {
    const { pages } = JSON.parse(await read("__canvas.json"))
    expect(await read("blog/index.html")).toContain("Fixture page")
    expect(await read("items/43/index.html")).toContain("Fixture page")
    expect(pages.map((page: { path: string }) => page.path).sort()).toEqual(["/", "/blog/:slug?", "/items/:id"])
    await expect(read("orders/42/index.html")).rejects.toMatchObject({ code: "ENOENT" })
  })
}, 30_000)
