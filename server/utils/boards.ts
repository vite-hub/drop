import { eq } from "drizzle-orm"
import { HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
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
import { drops } from "../databases/config"
import { type DropRow, escapesFolder, MAX_FILE_BYTES, readText, storageFailure } from "./drops"
import type { Identity } from "./identity"
import { textStatements } from "./search"

// A board is one living file. Unlike a doc, whose versions never change, people and agents edit the latest version
// of a board in place, the way an app's next version replaces its files: a whiteboard changes stroke by stroke, and a
// version per stroke would bury its history. Publishing with `previous` still makes a new version to come back to.
//
// TODO(board-realtime): browsers send their changes here and poll for everyone else's. A Realtime room per board
// (like server/realtime/drops.ts for Markdown) would show other people's cursors and strokes as they draw.

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

/**
 * Merges the elements people changed in Excalidraw, or an agent's edit, into the board, and stores it. Per element the
 * higher version wins (mergeElements): two people moving the same note keep the later move. Elements a board doesn't
 * take (images, embeds, anything malformed) are skipped rather than failing the save, so one bad element can't stop a
 * person's other strokes from saving.
 */
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
  const [error] = await blob.put(drop.blobKey!, bytes, { access: "private", contentType: BOARD_CONTENT_TYPE })
  if (error) throw storageFailure(error)
  const now = Date.now()
  await db.batch([
    db.update(drops).set({ size: bytes.byteLength, updatedAt: now }).where(eq(drops.id, drop.id)),
    ...textStatements(drop, text, drop.id),
  ])
  return { board, changed, updatedAt: now }
}

// Images: the browser that saves a board renders the overview and each frame as PNG (Excalidraw only renders in a
// browser) and sends them here, so agents can look at drawings the outline can only locate.

// Frame ids come from the board's elements, which may name any string: one that would leave the board's folder once the
// blob store decodes it gets no image.
const imageKey = (drop: DropRow, name: string) => (escapesFolder(name) ? null : `boards/${drop.link}/${name}.png`)
export const OVERVIEW = "overview"

export async function storeBoardImages(drop: DropRow, images: { frame: string; png: string }[]) {
  const board = await readBoard(drop)
  const frames = new Set(boardFrames(board).map((frame) => frame.id))
  for (const image of images) {
    if (image.frame !== OVERVIEW && !frames.has(image.frame)) continue
    const bytes = Uint8Array.from(atob(image.png), (char) => char.charCodeAt(0))
    // A PNG starts with these 8 bytes; anything else isn't stored.
    const key = imageKey(drop, image.frame)
    if (!key || bytes.byteLength > MAX_FILE_BYTES || bytes[0] !== 0x89 || bytes[1] !== 0x50) continue
    const [error] = await blob.put(key, bytes, { access: "private", contentType: "image/png" })
    if (error) throw storageFailure(error)
  }
}

/** The stored PNG of the overview or a frame, base64-encoded for an MCP image result, or null before any was sent. */
export async function boardImage(drop: DropRow, frame: string) {
  const key = imageKey(drop, frame)
  if (!key) return null
  const [error, file] = await blob.get(key)
  if (error?.code === "BLOB_NOT_FOUND") return null
  // Any other error is the store failing, which must not read as "no image yet".
  if (error) throw storageFailure(error)
  if (!file) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
