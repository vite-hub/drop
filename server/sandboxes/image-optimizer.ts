import { execFileSync } from "node:child_process"

import { defineDockerfile, defineSandbox } from "vite-hub/sandbox"

import { IMAGE_EXTENSIONS, type ImageContentType } from "../image-content-type"

export const dockerfile = defineDockerfile`
  RUN apt-get update \
    && apt-get install -y --no-install-recommends imagemagick \
    && rm -rf /var/lib/apt/lists/*
`

export default defineSandbox((payload: { bytes: string, contentType: ImageContentType }) => {
  const output = execFileSync("convert", ["-", "-auto-orient", "-strip", "-resize", "2048x2048>", `${IMAGE_EXTENSIONS[payload.contentType]}:-`], {
    input: Buffer.from(payload.bytes, "base64"),
    maxBuffer: 24 * 1024 * 1024,
    timeout: 60 * 1000,
  })

  return { bytes: output.toString("base64") }
}, { timeout: 60_000 })
