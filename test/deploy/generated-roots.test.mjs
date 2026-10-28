import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "vite-plus/test"
import { createServer } from "vite-plus"
import ts from "typescript"

const require = createRequire(import.meta.resolve("vite-hub"))
const { hubRateLimit } = await import(pathToFileURL(require.resolve("@vite-hub/rate-limit/vite")))
const { hubAuth } = await import(pathToFileURL(require.resolve("@vite-hub/auth/vite")))
const { hubContent, renderContentDevHandler } = await import(pathToFileURL(require.resolve("@vite-hub/content/vite")))

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

function definitionImport(source) {
  const imports = ts.preProcessFile(source).importedFiles
  const specifier = imports.find((item) => item.fileName.includes("/server/content.ts"))?.fileName
  assert.ok(specifier, source)
  return specifier
}

async function fetchDefinition(specifier, handler, definition) {
  const server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true },
    plugins: [
      {
        name: "content-definition-fixture",
        // Model the target file on this host; Vite's fetchModule still classifies the original specifier first.
        resolveId: (id) => (id === specifier ? definition : undefined),
      },
    ],
  })
  try {
    const fetched = await server.environments.ssr.fetchModule(specifier, handler)
    assert.equal(fetched.file, definition)
  } finally {
    await server.close()
  }
}

for (const command of ["build", "serve"]) {
  test(`Rate Limit generates Nitro files at the project root during ${command}`, () =>
    fixture(async (root) => {
      const plugin = hubRateLimit({ provider: "memory" })
      const config = { root: join(root, "app"), command, nitro: {}, plugins: [], build: {} }
      plugin.config(config, { command })
      await plugin.configResolved(config)
      for (const file of ["nitro/rate-limit/plugin.ts", "rate-limit/manifest.json"])
        await access(join(root, ".vitehub", file))
      for (const file of config.nitro.plugins) await access(file)
      if (command === "serve") {
        const handler = config.nitro.handlers.find((handler) => handler.handler.endsWith("rate-limit/dev-handler.ts"))
        assert.ok(handler)
        assert.equal(handler.handler, join(root, ".vitehub/nitro/rate-limit/dev-handler.ts"))
        await access(handler.handler)
      }
      await assert.rejects(access(join(root, "app/.vitehub")), { code: "ENOENT" })
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

test("Content's generated dev handler imports a definition TypeScript and Vite can resolve", () =>
  fixture(async (root) => {
    const definition = join(root, "server/content.ts")
    await writeFile(definition, "export const content = {}\n")
    const handler = join(root, ".vitehub/nitro/content/dev-handler.ts")
    const plugin = hubContent()
    await plugin.config.handler({ root: join(root, "app"), nitro: {} }, { command: "serve" })
    const source = await readFile(handler, "utf8")
    const specifier = definitionImport(source)
    const resolved = ts.resolveModuleName(
      specifier,
      handler,
      { moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true },
      ts.sys,
    ).resolvedModule
    assert.equal(resolved?.resolvedFileName, definition, source)
    await fetchDefinition(specifier, handler, definition)
  }))

test("Content's Windows definition import passes TypeScript resolution and Vite's runtime classification", () =>
  fixture(async (root) => {
    const definition = "C:\\project\\server\\content.ts"
    const handler = "C:/project/.vitehub/nitro/content/dev-handler.ts"
    const source = renderContentDevHandler({ definition, handler })
    const specifier = definitionImport(source)
    const resolved = ts.resolveModuleName(
      specifier,
      handler,
      { moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true },
      { fileExists: (file) => file === "C:/project/server/content.ts", readFile: () => "export const content = {}" },
    ).resolvedModule
    assert.equal(resolved?.resolvedFileName, "C:/project/server/content.ts", source)
    const runtimeDefinition = join(root, "server/content.ts")
    await writeFile(runtimeDefinition, "export const content = {}\n")
    await fetchDefinition(specifier, handler, runtimeDefinition)
  }))
