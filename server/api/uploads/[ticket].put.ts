import { useLogger } from "evlog/nitro/v3"
import { assertBodySize, defineHandler, getRouterParam, HTTPError } from "h3"
import { MIB } from "#shared/quotas"
import { MAX_ARCHIVE_BYTES } from "../../utils/app-archive"
import { MAX_FILE_BYTES } from "../../utils/drops"
import { publishInput } from "../../utils/publish"
import { claimUpload, readUpload, releaseUpload } from "../../utils/uploads"

/**
 * The upload URL `publish` hands out for a file or a built app: `curl -T before.png '<uploadUrl>'`, or
 * `tar -czf - -C dist . | curl -T - '<uploadUrl>'`. The ticket in the path stands in for the agent's sign-in, so this
 * needs no token. It finishes that publish call with the body's bytes and answers with the drop, like `publish` would
 * have.
 */
export default defineHandler(async (event) => {
  const upload = await readUpload(event, getRouterParam(event, "ticket")!)
  if (!upload) {
    await event.req.body?.cancel().catch(() => {})
    throw new HTTPError({
      status: 403,
      statusText: "This upload URL has run out or isn't valid. Call publish again for a new one.",
    })
  }
  // An archive is compressed, so it never needs more room than the largest app unpacked.
  const [limit, what] = upload.input.archive ? [MAX_ARCHIVE_BYTES, "archive"] : [MAX_FILE_BYTES, "file"]
  const tooLarge = () =>
    new HTTPError({ status: 413, statusText: `The ${what} exceeds the ${Math.round(limit / MIB)} MiB limit.` })
  // `curl -T -` streams the body chunked, with no length to check up front: h3 counts the bytes as they arrive.
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
  if (!(await claimUpload(upload.id, upload.expiresAt)))
    throw new HTTPError({
      status: 409,
      statusText: "This upload URL was already used. Call publish again to upload another file.",
    })
  try {
    const { result } = await publishInput(upload.who, upload.input, event, bytes)
    useLogger(event).set({
      user: { id: upload.who.userId },
      actor: { kind: upload.who.actorKind, name: upload.who.actorName },
      drop: { id: "id" in result ? result.id : undefined, size: bytes.byteLength },
    })
    event.res.headers.set("Cache-Control", "no-store")
    return result
  } catch (error) {
    await releaseUpload(upload.id)
    throw error
  }
})
