import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "vite-plus/test"

const require = createRequire(import.meta.resolve("vite-hub"))
const { hubRateLimit } = await import(pathToFileURL(require.resolve("@vite-hub/rate-limit/vite")))
const { hubAuth } = await import(pathToFileURL(require.resolve("@vite-hub/auth/vite")))
const { hubContent } = await import(pathToFileURL(require.resolve("@vite-hub/content/vite")))
const { hubWorkspace, createWorkspaceNitroConfig } = await import(
  pathToFileURL(require.resolve("@vite-hub/workspace/vite"))
)

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "drop-generated-roots-"))
  try {
    await mkdir(join(root, "app"))
    await mkdir(join(root, "server"))
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

for (const command of ["build", "serve"]) {
  test(`Rate Limit generates Nitro files at the project root during ${command}`, () =>
    fixture(async (root) => {
      const plugin = hubRateLimit({ provider: "memory" })
      const config = { root: join(root, "app"), command, nitro: {}, plugins: [], build: {} }
      await plugin.config.handler(config, { command })
      await plugin.configResolved(config)
      for (const file of ["nitro/rate-limit/plugin.ts", "rate-limit/manifest.json"])
        await access(join(root, ".vitehub", file))
      for (const file of config.nitro.plugins) await access(file)
      assert.ok(config.nitro.plugins.includes(join(root, ".vitehub/nitro/rate-limit/plugin.ts")))
      await assert.rejects(access(join(root, "app/.vitehub")), { code: "ENOENT" })
    }))
}

for (const entry of ["plugin config", "Nitro config"]) {
  test(`Workspace's assets alias is loadable before configResolved from ${entry}`, () =>
    fixture(async (root) => {
      const workspace = { root: ".data/workspaces", store: { provider: "local" } }
      const configure = async () => {
        if (entry === "Nitro config")
          return createWorkspaceNitroConfig({ viteRoot: join(root, "app"), command: "build", workspace })
        const plugin = hubWorkspace(workspace)
        const config = { root: join(root, "app"), nitro: {}, plugins: [] }
        await plugin.config(config, { command: "build" })
        return config.nitro
      }
      const registry = (await configure()).alias["#vitehub-workspace-assets-registry"]
      assert.equal(registry, join(root, ".vitehub/vite-runtime/workspace/assets/registry.mjs"))
      assert.deepEqual((await import(pathToFileURL(registry))).default, {})
      // Nuxt can replay config after Vite has populated the registry; keep those built assets.
      const populated = "export default { built: {} }\n"
      await writeFile(registry, populated)
      await configure()
      assert.equal(await readFile(registry, "utf8"), populated)
    }))
}

test("Auth generates ambient types and Nitro handlers at the project root", () =>
  fixture(async (root) => {
    const plugin = hubAuth()
    const config = { root: join(root, "app"), plugins: [] }
    await plugin.configResolved(config)
    await access(join(root, ".vitehub/types/auth.d.ts"))
    await access(join(root, ".vitehub/auth/route.ts"))
    await access(join(root, ".vitehub/auth/access-middleware.ts"))
    await assert.rejects(access(join(root, "app/.vitehub")), { code: "ENOENT" })
  }))

// ViteHub 0.1 exposes Content through shared operations, without a per-definition dev handler or path import.
test("Content discovers the project-root definition and contributes loadable operations", () =>
  fixture(async (root) => {
    await writeFile(join(root, "server/content.ts"), "export default {}\n")
    const plugin = hubContent()
    const config = { root: join(root, "app"), plugins: [plugin], resolve: { alias: [] } }
    await plugin.config.handler(config)
    await plugin.configResolved(config)
    const contributions = await plugin.vitehub.operations()
    assert.equal(contributions.length, 1)
    const [contribution] = contributions
    const runtime = await import(pathToFileURL(require.resolve(contribution.module)))
    const operations = await contribution.load()
    assert.equal(operations, runtime[contribution.export])
    assert.ok(operations.some((operation) => operation.name === "content.list"))
    await assert.rejects(access(join(root, "app/.vitehub")), { code: "ENOENT" })
  }))

test("Content contributes no operations when the project has no definition", () =>
  fixture(async (root) => {
    const plugin = hubContent()
    const config = { root: join(root, "app"), plugins: [plugin], resolve: { alias: [] } }
    await plugin.config.handler(config)
    await plugin.configResolved(config)
    assert.deepEqual(await plugin.vitehub.operations(), [])
  }))
