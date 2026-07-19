import { watch } from "node:fs"
import { spawn } from "node:child_process"

const sources = ["server", "skills", "public", "vite.config.ts"]

await build()

const worker = spawn("pnpm", ["exec", "wrangler", "dev", "--config", ".output/server/wrangler.json", "--persist-to", ".data", "--port", "3031"], {
  stdio: "inherit",
})
const watchers = sources.map(source => watch(source, { recursive: true }, scheduleBuild))

let buildTimer
let building = false
let pending = false

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => worker.kill(signal))
}

const exitCode = await new Promise((resolve, reject) => {
  worker.once("error", reject)
  worker.once("exit", code => resolve(code ?? 1))
})

for (const watcher of watchers) watcher.close()
process.exitCode = exitCode

function scheduleBuild() {
  clearTimeout(buildTimer)
  buildTimer = setTimeout(rebuild, 100)
}

async function rebuild() {
  if (building) {
    pending = true
    return
  }

  building = true
  do {
    pending = false
    await build()
  } while (pending)
  building = false
}

function build() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["build"], { stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Build exited with code ${code}.`)))
  })
}
