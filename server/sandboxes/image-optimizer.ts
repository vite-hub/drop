import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { promisify } from "node:util"

import { defineSandbox } from "vite-hub/sandbox"


const run = promisify(execFile)
const extensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export default defineSandbox(async (payload: {
  bytes: string
  contentType: keyof typeof extensions
  maxDimension: number
}) => {
  const directory = `/tmp/vitehub-image-${randomUUID()}`
  const extension = extensions[payload.contentType]
  const input = `${directory}/input.${extension}`
  const output = `${directory}/output.${extension}`

  await mkdir(directory, { recursive: true })
  try {
    await writeFile(input, Buffer.from(payload.bytes, "base64"))
    await run("convert", [
      input,
      "-auto-orient",
      "-strip",
      "-resize",
      `${payload.maxDimension}x${payload.maxDimension}>`,
      output,
    ])
    return { bytes: (await readFile(output)).toString("base64") }
  }
  finally {
    await rm(directory, { force: true, recursive: true })
  }
}, { timeout: 60_000 })
