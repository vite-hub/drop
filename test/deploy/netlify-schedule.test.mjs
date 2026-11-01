import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm, cp, access } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build, createNitro, prepare } from "nitro/builder"
import { test } from "vite-plus/test"

const require = createRequire(import.meta.resolve("vite-hub"))
const { createScheduleNitroConfig } = await import(pathToFileURL(require.resolve("@vite-hub/schedule/vite")))

test("Netlify emits an hourly cleanup function that runs with Nitro's aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "drop-netlify-schedule-"))
  let nitro
  try {
    await mkdir(join(root, "app"))
    await mkdir(join(root, "server/schedules"), { recursive: true })
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await writeFile(join(root, "cleanup.ts"), "export const record = event => { globalThis.dropScheduleEvent = event }")
    await writeFile(
      join(root, "server/schedules/cleanup.ts"),
      `
      import { defineSchedule } from ${JSON.stringify(require.resolve("@vite-hub/schedule"))}
      import { record } from '#cleanup'
      export default defineSchedule({ cron: '0 * * * *', handler: record })
    `,
    )
    const config = await createScheduleNitroConfig({
      command: "build",
      root: join(root, "app"),
      projectRoot: root,
      nitroOwnsPaths: true,
      providerOutput: "standalone",
      nitro: { preset: "netlify" },
    })
    assert.ok(config, "Netlify schedules must contribute generated output to Nitro")
    nitro = await createNitro({
      ...config,
      rootDir: root,
      configFile: false,
      serverDir: false,
      serverEntry: false,
      compatibilityDate: "2026-07-17",
      alias: { "#cleanup": join(root, "cleanup.ts") },
      nodeModulesDirs: [fileURLToPath(new URL("../../node_modules", import.meta.url))],
    })
    await prepare(nitro)
    await build(nitro)
    await access(join(root, ".netlify/v1/functions/server/server.mjs"))
    const functionName = "vitehub-schedule-cleanup"
    const output = join(root, ".netlify/v1/functions", functionName)
    await access(join(output, `${functionName}.mjs`))
    // Like Netlify, load the function from its own deployed directory, without the app sources or sibling functions.
    const deployed = join(root, "deployed")
    await cp(output, deployed, { recursive: true })
    const handler = await import(pathToFileURL(join(deployed, `${functionName}.mjs`)))
    assert.equal(handler.config.schedule, "0 * * * *")
    assert.equal(handler.config.nodeBundler, "none")
    const response = await handler.default(new Request("https://drop.netlify.app/"))
    assert.equal(response.status, 204)
    assert.ok(globalThis.dropScheduleEvent.scheduledAt instanceof Date)
    assert.equal(globalThis.dropScheduleEvent.cron, "0 * * * *")
  } finally {
    delete globalThis.dropScheduleEvent
    await nitro?.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
