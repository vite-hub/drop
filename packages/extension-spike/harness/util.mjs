import { writeFileSync } from "node:fs"

// Runs one check with a deadline, so a hung browser prompt becomes a recorded result instead of a hung harness.
export async function step(name, fn, ms = 10_000) {
  let timer
  const started = Date.now()
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
      }),
    ])
    console.log(`ok   ${name}`)
    return { ok: true, ms: Date.now() - started, value }
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`)
    return { ok: false, ms: Date.now() - started, error: error.message.split("\n")[0] }
  } finally {
    clearTimeout(timer)
  }
}

export function pngSize(dataUrl) {
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64")
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

export function report(out, file) {
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
  console.log(JSON.stringify(out, null, 2))
}
