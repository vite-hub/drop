import { Buffer } from "node:buffer"
import { and, eq } from "drizzle-orm"
import { HTTPError } from "h3"
import { lookup } from "mrmime"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { MAX_FILE_BYTES } from "#shared/schemas"
import { dropFiles } from "../databases/default/index"
import { permissions, type DropRow } from "./drops"
import type { Identity } from "./identity"

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const missing = () => new HTTPError({ status: 404, message: "File not found." })
const tooLarge = () => new HTTPError({ status: 413, message: "MCP file reads take at most 4 MiB." })

export async function agentFile(drop: DropRow, who: Identity, path?: string, format: "auto" | "resource" = "auto") {
  if (!permissions(drop, who).view) throw missing()
  const file =
    drop.kind === "app"
      ? (
          await db
            .select()
            .from(dropFiles)
            .where(and(eq(dropFiles.dropId, drop.id), eq(dropFiles.path, path ?? "")))
            .limit(1)
        )[0]
      : path === undefined && drop.blobKey
        ? { blobKey: drop.blobKey, filename: drop.filename, contentType: drop.contentType, size: drop.size }
        : null
  if (!file) throw missing()
  if (file.size > MAX_FILE_BYTES) throw tooLarge()
  const [headError, head] = await blob.head(file.blobKey)
  if (headError && headError.code !== "BLOB_NOT_FOUND")
    throw new HTTPError({ status: 503, message: "File storage is temporarily unavailable." })
  if (!head) throw missing()
  if (head.size === undefined) throw new HTTPError({ status: 503, message: "File size is temporarily unavailable." })
  if (head.size > MAX_FILE_BYTES) throw tooLarge()
  const [error, body] = await blob.get(file.blobKey)
  if (error && error.code !== "BLOB_NOT_FOUND")
    throw new HTTPError({ status: 503, message: "File storage is temporarily unavailable." })
  if (!body) throw missing()
  if (body.size > MAX_FILE_BYTES) throw tooLarge()
  const bytes = await body.arrayBuffer()
  if (bytes.byteLength > MAX_FILE_BYTES) throw tooLarge()
  const data = Buffer.from(bytes).toString("base64")
  const filename = "path" in file ? file.path : file.filename
  const mimeType = ("path" in file ? lookup(file.path) : file.contentType) || "application/octet-stream"
  const uri = `drop-file:///${encodeURIComponent(drop.id)}/${encodeURIComponent(filename)}`
  const content =
    format === "auto" && imageTypes.has(mimeType)
      ? { type: "image" as const, data, mimeType }
      : { type: "resource" as const, resource: { uri, mimeType, blob: data } }
  return { content, file: { id: drop.id, filename, mimeType, size: bytes.byteLength, uri } }
}
