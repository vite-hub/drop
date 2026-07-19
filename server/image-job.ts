export type ImageContentType = "image/jpeg" | "image/png" | "image/webp"

export interface ImageJob {
  completedAt?: string
  contentType: ImageContentType
  createdAt: string
  error?: string
  finalSize?: number
  id: string
  optimized?: boolean
  originalSize: number
  savedBytes?: number
  status: "queued" | "processing" | "complete" | "failed"
}

export type QueuedImageJob = ImageJob & {status: "queued"}

export interface ImageSaving {
  finalSize: number
  originalSize: number
  savedBytes: number
}

export const imageJobKey = (id: string) => `jobs:${id}`
export const imageSavingKey = (id: string) => `savings:${id}`

export function imageJobFromMetadata(id: string, metadata: Record<string, string | undefined>) {
  const contentType = metadata.contentType
  const originalSize = Number(metadata.originalSize)
  if (
    !metadata.createdAt
    || (contentType !== "image/jpeg" && contentType !== "image/png" && contentType !== "image/webp")
    || !Number.isSafeInteger(originalSize)
    || originalSize < 1
  ) return

  const job: QueuedImageJob = {
    contentType,
    createdAt: metadata.createdAt,
    id,
    originalSize,
    status: "queued",
  }
  if (metadata.status !== "complete") return job

  const finalSize = Number(metadata.finalSize)
  if (!Number.isSafeInteger(finalSize) || finalSize < 1 || finalSize > originalSize) return job
  return {
    ...job,
    completedAt: metadata.completedAt,
    finalSize,
    optimized: metadata.optimized === "true",
    savedBytes: originalSize - finalSize,
    status: "complete" as const,
  }
}
