import { useLogger } from "evlog/nitro/v3"
import { assertBodySize, defineHandler, getRouterParam, HTTPError } from "h3"
import { MAX_FILE_BYTES } from "#shared/schemas"
import { mcpDrop } from "../../../mcp/format"
import { readImageUpload, storeDocImage, usedImageUpload } from "../../../utils/doc-images"
import { toSummary } from "../../../utils/drops"
import { logActor } from "../../../utils/logs"
import { invalidUpload, publishUploadOnce, ticketIdentity } from "../../../utils/uploads"

export default defineHandler(async (event) => {
  const ticket = await readImageUpload(event, getRouterParam(event, "ticket")!)
  const who = ticket && (await ticketIdentity(event, ticket))
  if (!ticket || !who) {
    await event.req.body?.cancel().catch(() => {})
    throw invalidUpload()
  }
  let bytes: Uint8Array
  try {
    assertBodySize(event, MAX_FILE_BYTES)
    bytes = new Uint8Array(await event.req.arrayBuffer())
  } catch (error) {
    throw HTTPError.isError(error) && error.status === 413
      ? new HTTPError({ status: 413, statusText: "The image exceeds the 4 MiB limit." })
      : error
  }
  if (!bytes.byteLength)
    throw new HTTPError({
      status: 400,
      statusText: "The upload is empty. Send the image as the body, as curl -T does.",
    })
  const stored = await publishUploadOnce(ticket.j, ticket.e, () => storeDocImage(who, ticket, bytes, event))
  if (!stored) throw usedImageUpload()
  logActor(event, who)
  useLogger(event).set({ drop: { id: stored.value.id, size: bytes.byteLength } })
  event.res.headers.set("Cache-Control", "no-store")
  return mcpDrop(toSummary(stored.value), event.url.origin, stored.value)
})
