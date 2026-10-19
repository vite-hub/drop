import { useLogger } from "evlog/nitro/v3"
import { defineHandler, HTTPError } from "h3"
import { MAX_FILE_BYTES } from "../../utils/drops"
import { publishInput } from "../../utils/publish"
import { claimUpload, readUpload, releaseUpload } from "../../utils/uploads"

/**
 * The upload URL `publish` hands out for a file: `curl -T before.png '<uploadUrl>'`. The ticket in the path stands in
 * for the agent's sign-in, so this needs no token. It finishes that publish call with the body's bytes and answers
 * with the drop, like `publish` would have.
 */
export default defineHandler(async (event) => {
  const upload = await readUpload(event, event.context.params!.ticket!)
  if (!upload) {
    await event.req.body?.cancel().catch(() => {})
    throw new HTTPError({
      status: 403,
      statusText: "This upload URL has run out or isn't valid. Call publish again for a new one.",
    })
  }
  if (Number(event.req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })
  const bytes = new Uint8Array(await event.req.arrayBuffer())
  if (!bytes.byteLength)
    throw new HTTPError({ status: 400, statusText: "The upload is empty. Send the file as the body, as curl -T does." })
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })
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
