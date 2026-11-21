import { useLogger } from "evlog/nitro/v3"
import { assertBodySize, defineHandler, getRouterParam, HTTPError } from "h3"
import { MIB } from "#shared/quotas"
import { MAX_ARCHIVE_BYTES } from "../../utils/app-archive"
import { MAX_FILE_BYTES } from "../../utils/drops"
import { logActor } from "../../utils/logs"
import { publishInput } from "../../utils/publish"
import { invalidUpload, publishUploadOnce, readUpload } from "../../utils/uploads"

export default defineHandler(async (event) => {
  const upload = await readUpload(event, getRouterParam(event, "ticket")!)
  if (!upload) {
    await event.req.body?.cancel().catch(() => {})
    throw invalidUpload()
  }
  const [limit, what] = upload.input.archive ? [MAX_ARCHIVE_BYTES, "archive"] : [MAX_FILE_BYTES, "file"]
  const tooLarge = () =>
    new HTTPError({ status: 413, statusText: `The ${what} exceeds the ${Math.round(limit / MIB)} MiB limit.` })
  let bytes: Uint8Array
  try {
    assertBodySize(event, limit)
    bytes = new Uint8Array(await event.req.arrayBuffer())
  } catch (error) {
    throw HTTPError.isError(error) && error.status === 413 ? tooLarge() : error
  }
  if (!bytes.byteLength)
    throw new HTTPError({
      status: 400,
      statusText: `The upload is empty. Send the ${what} as the body, as curl -T does.`,
    })
  const published = await publishUploadOnce(upload.id, upload.expiresAt, () =>
    publishInput(upload.who, upload.input, event, bytes),
  )
  if (!published)
    throw new HTTPError({
      status: 409,
      statusText: "This upload URL was already used. Call publish again to upload another file.",
    })
  const { result } = published.value
  logActor(event, upload.who)
  useLogger(event).set({ drop: { id: "id" in result ? result.id : undefined, size: bytes.byteLength } })
  event.res.headers.set("Cache-Control", "no-store")
  return result
})
