import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const results = fileURLToPath(new URL("./results/", import.meta.url))

export async function step(name, fn, ms = 15_000) {
  let timer
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
      }),
    ])
    console.log(`ok   ${name}`)
    return { ok: true, value }
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message.split("\n")[0]}`)
    return { ok: false, error: error.message.split("\n")[0] }
  } finally {
    clearTimeout(timer)
  }
}

export function report(out, name) {
  mkdirSync(results, { recursive: true })
  writeFileSync(`${results}${name}.json`, `${JSON.stringify(out, null, 2)}\n`)
  const failed = Object.entries(out.checks).filter(([, check]) => !check.ok)
  console.log(failed.length ? `${failed.length} check(s) failed` : "all checks passed")
  process.exitCode = failed.length ? 1 : 0
}
