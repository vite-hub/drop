import { watch } from "node:fs"
import { spawn } from "node:child_process"
import { once } from "node:events"

const sources = ["server", "skills", "public", "vite.config.ts"]

await build()

const worker = spawn("pnpm", ["exec", "wrangler", "dev", "--config", ".output/server/wrangler.json", "--persist-to", ".data", "--port", "3031"], {
  stdio: "inherit",
})
const watchers = sources.map(source => watch(source, { recursive: true }, scheduleBuild))

let buildTimer
let rebuild = Promise.resolve()

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => worker.kill(signal))
}

const [exitCode] = await once(worker, "exit")

for (const watcher of watchers) watcher.close()
process.exitCode = exitCode ?? 1

function scheduleBuild() {
  clearTimeout(buildTimer)
  buildTimer = setTimeout(() => {
    rebuild = rebuild.then(build).catch(console.error)
  }, 100)
}

async function build() {
  const [code] = await once(spawn("pnpm", ["build"], { stdio: "inherit" }), "exit")
  if (code !== 0) throw new Error(`Build exited with code ${code}.`)
}
