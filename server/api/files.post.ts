import { useLogger } from "evlog/nitro/v3"
import { defineHandler, HTTPError, requireContentType } from "h3"
import { textValue } from "#shared/utils/text"
import { createDocDrop, dropPageUrl, findDrop, MAX_FILE_BYTES, permissions } from "../utils/drops"
import { embedResponse, openedEmbeds } from "../utils/embed-access"
import { requireFolder } from "../utils/folders"
import { requireIdentity } from "../utils/identity"
import { readFormWithin } from "../utils/params"

export default defineHandler(async (event) => {
  const who = await requireIdentity(event).catch(async (error) => {
    await event.req.body?.cancel().catch(() => {})
    throw error
  })
  requireContentType(event, "multipart/form-data")

  let form: FormData
  try {
    form = await readFormWithin(event, MAX_FILE_BYTES + 64 * 1024)
  } catch (error) {
    if (HTTPError.isError(error) && error.status === 413)
      throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })
    throw new HTTPError({ status: 400, statusText: "Exactly one file is required." })
  }
  const file = form.get("file")
  if (!(file instanceof File) || form.getAll("file").length !== 1)
    throw new HTTPError({ status: 400, statusText: "Exactly one file is required." })
  if (file.size > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })

  const document = textValue(form.get("document"))
  const attachment = document ? await findDrop(document, event) : null
  if (
    form.has("document") &&
    (who.actorKind !== "browser" || attachment?.kind !== "markdown" || !permissions(attachment, who).edit)
  )
    throw new HTTPError({ status: 404, statusText: "You can't edit this drop." })
  const folderRef = attachment ? undefined : textValue(form.get("folder"))
  const folder = folderRef ? await requireFolder(folderRef, who, event) : undefined
  const input = { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
  const drop = await createDocDrop(
    who,
    attachment
      ? { ...input, attachment }
      : {
          ...input,
          title: textValue(form.get("title")),
          slug: textValue(form.get("slug"))?.slice(0, 200),
          supersedes: textValue(form.get("supersedes")),
          folder,
        },
    event,
  )
  useLogger(event).set({ drop: { id: drop.id, kind: drop.kind, size: drop.size, version: drop.version } })
  const origin = event.url.origin
  const path = `/f/${drop.blobKey}`
  const embeds = drop.kind === "markdown" && !attachment ? embedResponse(await openedEmbeds(drop.id, who, event)) : {}
  return {
    id: drop.id,
    url: attachment ? path : new URL(path, origin).href,
    page: dropPageUrl(origin, drop),
    share: drop.share,
    version: drop.version,
    ...embeds,
  }
})
