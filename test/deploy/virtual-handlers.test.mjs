import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadOptions } from "nitro/builder"
import { test } from "vite-plus/test"

test("Nitro keeps ViteHub's delegated MCP discovery middleware linked to its virtual module", async () => {
  const root = await mkdtemp(join(tmpdir(), "drop-virtual-handlers-"))
  const discovery = "virtual:vitehub/console-mcp-discovery"
  try {
    const config = await loadOptions({
      rootDir: root,
      configFile: false,
      serverDir: false,
      serverEntry: false,
      preset: "cloudflare-durable",
      compatibilityDate: "2026-07-17",
      handlers: [
        { route: "/**", middleware: true, handler: discovery },
        { route: "/.well-known/oauth-protected-resource", handler: "server/oauth-metadata.ts" },
      ],
      virtual: { [discovery]: "export default () => {}" },
    })
    const middleware = config.handlers.find((handler) => handler.middleware)
    assert.equal(middleware.handler, discovery)
    assert.ok(Object.hasOwn(config.virtual, middleware.handler))
    assert.equal(config.handlers[1].handler, join(root, "server/oauth-metadata.ts"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
