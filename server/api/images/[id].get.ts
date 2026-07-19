import { useServerEnv } from "#vitehub/env/server"
import { defineHandler, getRouterParam, HTTPError, setResponseHeaders } from "h3"
import { blob } from "vite-hub/blob"
import { kv } from "vite-hub/kv"
import * as v from "valibot"

import { imageJobFromMetadata, imageJobKey, type ImageJob } from "../../image-job"
import { imageKeySchema } from "../../image-key"

export default defineHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!v.is(imageKeySchema, id)) throw new HTTPError({ status: 404, statusText: "Image job not found." })

  const [kvJob, stored] = await Promise.all([
    kv.get<ImageJob>(imageJobKey(id)),
    blob.head(id).catch(() => null),
  ])
  const storedJob = stored && imageJobFromMetadata(id, stored.customMetadata)
  const job = kvJob?.status === "failed" || kvJob?.status === "complete"
    ? kvJob
    : storedJob?.status === "complete" ? storedJob : kvJob ?? storedJob
  if (!job) throw new HTTPError({ status: 404, statusText: "Image job not found." })

  setResponseHeaders(event, {
    "Cache-Control": "no-store",
    ...(job.status === "queued" || job.status === "processing" ? { "Retry-After": "1" } : {}),
  })

  if (job.status !== "complete") return job

  const origin = useServerEnv(event).dropOrigin.replace(/\/$/, "")
  return { ...job, url: `${origin}/i/${id}` }
})
