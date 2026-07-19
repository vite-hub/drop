import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { promisify } from "node:util"

import { defineSandbox } from "vite-hub/sandbox"

import { imageExtension, type ImageContentType } from "../image-content-type"

const execFileAsync = promisify(execFile)

export default defineSandbox(async (payload: {
  bytes: string
  contentType: ImageContentType
}) => {
  const directory = `/tmp/vitehub-image-${randomUUID()}`
  const extension = imageExtension(payload.contentType)
  const input = `${directory}/input.${extension}`
  const output = `${directory}/output.${extension}`

  await mkdir(directory, { recursive: true })
  try {
    await writeFile(input, Buffer.from(payload.bytes, "base64"))
    await execFileAsync("convert", [
      input,
      "-auto-orient",
      "-strip",
      "-resize",
      "2048x2048>",
      output,
    ])
    return { bytes: (await readFile(output)).toString("base64") }
  }
  finally {
    await rm(directory, { force: true, recursive: true })
  }
}, { timeout: 60_000 })
