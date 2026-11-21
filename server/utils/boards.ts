import { eq } from "drizzle-orm"
import { HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database"
import {
  BOARD_CONTENT_TYPE,
  type Board,
  boardChanges,
  type BoardEdit,
  type BoardElement,
  boardFrames,
  isBoardElement,
  mergeElements,
  parseBoard,
  serializeBoard,
} from "#shared/board"
import { base64 } from "#shared/utils/bytes"
import { drops } from "../databases/default/index"
import { type DropRow, escapesFolder, MAX_FILE_BYTES, readText, storageFailure } from "./drops"
import type { Identity } from "./identity"
import { textStatements } from "./search"

export async function readBoard(drop: DropRow): Promise<Board> {
  if (drop.kind !== "board" || !drop.blobKey)
    throw new HTTPError({ status: 400, statusText: "That drop isn't a board." })
  try {
    return parseBoard(await readText(drop.blobKey))
  } catch (error) {
    if (HTTPError.isError(error)) throw error
    throw new HTTPError({ status: 500, statusText: "This board's file can't be read.", cause: error })
  }
}

export async function writeBoard(
  drop: DropRow,
  change: { elements: unknown[]; who: Identity | null } | { edit: BoardEdit; who: Identity },
) {
  const board = await readBoard(drop)
  let put: BoardElement[]
  if ("edit" in change) {
    try {
      ;({ put } = boardChanges(board, change.edit, change.who.actorName))
    } catch (error) {
      throw new HTTPError({ status: 400, message: error instanceof Error ? error.message : String(error) })
    }
  } else put = change.elements.filter(isBoardElement)
  const changed = mergeElements(board, put, change.who?.actorName)
  const text = serializeBoard(board)
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: "The board is over the 4 MiB limit. Split it into two boards." })
  const [error] = await blob.put(drop.blobKey!, bytes, { contentType: BOARD_CONTENT_TYPE })
  if (error) throw storageFailure(error)
  const now = Date.now()
  await db.batch([
    db.update(drops).set({ size: bytes.byteLength, updatedAt: now }).where(eq(drops.id, drop.id)),
    ...textStatements(drop, text),
  ])
  return { board, changed, updatedAt: now }
}

const imageKey = (drop: DropRow, name: string) => (escapesFolder(name) ? null : `boards/${drop.id}/${name}.png`)
export const OVERVIEW = "overview"

export async function storeBoardImages(drop: DropRow, images: { frame: string; png: string }[]) {
  const board = await readBoard(drop)
  const frames = new Set(boardFrames(board).map((frame) => frame.id))
  for (const image of images) {
    if (image.frame !== OVERVIEW && !frames.has(image.frame)) continue
    const bytes = Uint8Array.from(atob(image.png), (char) => char.charCodeAt(0))
    const key = imageKey(drop, image.frame)
    if (!key || bytes.byteLength > MAX_FILE_BYTES || bytes[0] !== 0x89 || bytes[1] !== 0x50) continue
    const [error] = await blob.put(key, bytes, { contentType: "image/png" })
    if (error) throw storageFailure(error)
  }
}

export async function boardImage(drop: DropRow, frame: string) {
  const key = imageKey(drop, frame)
  if (!key) return null
  const [error, file] = await blob.get(key)
  if (error?.code === "BLOB_NOT_FOUND") return null
  if (error) throw storageFailure(error)
  if (!file) return null
  return base64(new Uint8Array(await file.arrayBuffer()))
}
