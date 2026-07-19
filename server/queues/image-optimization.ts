import { Buffer } from "node:buffer"

import { runSandbox } from "vite-hub/sandbox"

import { useServerEnv } from "#vitehub/env/server"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { kv } from "vite-hub/kv"
import { defineQueue } from "vite-hub/queue"
import * as v from "valibot"

import { imageJobFromMetadata, type ImageJob, imageJobKey, type ImageSaving, imageSavingKey, type QueuedImageJob } from "../image-job"
import { imageKeySchema } from "../image-key"

const payloadSchema = v.object({
  contentType: v.picklist(["image/jpeg", "image/png", "image/webp"]),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
  id: imageKeySchema,
  originalSize: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  status: v.literal("queued"),
})

async function completeJob(job: ImageJob, finalSize: number, optimized: boolean) {
  const savedBytes = job.originalSize - finalSize
  const completed: ImageJob = {
    ...job,
    completedAt: new Date().toISOString(),
    finalSize,
    optimized,
    savedBytes,
    status: "complete",
  }
  const saving: ImageSaving = { finalSize, originalSize: job.originalSize, savedBytes }
  await kv.set(imageJobKey(job.id), completed)
  await kv.set(imageSavingKey(job.id), saving)
}

async function recoverCompletedJob(job: ImageJob) {
  let stored
  try {
    stored = await blob.head(job.id)
  }
  catch {
    return false
  }

  const storedJob = imageJobFromMetadata(job.id, stored.customMetadata)
  if (storedJob?.status !== "complete") return false
  await completeJob(job, storedJob.finalSize, storedJob.optimized)
  return true
}

export default defineQueue<QueuedImageJob>(async ({ attempts, payload }) => {
  const parsed = v.safeParse(payloadSchema, payload)
  if (!parsed.success) {
    console.error(JSON.stringify({ counter: "optimization_invalid_payload" }))
    return
  }

  const job: QueuedImageJob = parsed.output

  try {
    if (await recoverCompletedJob(job)) return

    await kv.set(imageJobKey(job.id), { ...job, status: "processing" } satisfies ImageJob)
    const original = await blob.get(job.id)
    if (!original) throw new Error("Original image is missing.")

    const originalBytes = new Uint8Array(await original.arrayBuffer())
    const maxDimension = Number(useServerEnv().imageMaxDimension)
    if (!Number.isSafeInteger(maxDimension) || maxDimension < 1) throw new Error("IMAGE_MAX_DIMENSION must be a positive integer.")

    const result = await runSandbox("image-optimizer", {
      bytes: Buffer.from(originalBytes).toString("base64"),
      contentType: job.contentType,
      maxDimension,
    })
    if ("error" in result) throw result.error

    const candidate = new Uint8Array(Buffer.from(result.value.bytes, "base64"))
    if (!candidate.byteLength || detectContentType(candidate) !== job.contentType) {
      throw new Error("Sandbox returned an invalid image.")
    }

    const optimized = candidate.byteLength < originalBytes.byteLength
    const finalBytes = optimized ? candidate : originalBytes
    await blob.put(job.id, finalBytes, {
      access: "private",
      contentType: job.contentType,
      customMetadata: {
        contentType: job.contentType,
        completedAt: new Date().toISOString(),
        createdAt: job.createdAt,
        finalSize: String(finalBytes.byteLength),
        optimized: String(optimized),
        originalSize: String(job.originalSize),
        status: "complete",
      },
    })
    await completeJob(job, finalBytes.byteLength, optimized)
  }
  catch (error) {
    console.error(JSON.stringify({
      attempts,
      counter: "optimization_failure",
      error: error instanceof Error ? error.message : String(error),
      key: job.id,
    }))
    if (await recoverCompletedJob(job)) return
    if (attempts < 3) throw error

    await kv.set(imageJobKey(job.id), {
      ...job,
      completedAt: new Date().toISOString(),
      error: "Image optimization failed.",
      status: "failed",
    } satisfies ImageJob)
  }
}, { concurrency: 1 })
