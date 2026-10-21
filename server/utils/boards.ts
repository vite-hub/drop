import { eq } from "drizzle-orm"
import { HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import {
  applyChanges,
  BOARD_CONTENT_TYPE,
  boardChanges,
  type BoardEdit,
  boardFrames,
  type BoardSnapshot,
  parseBoard,
  validateRecord,
} from "#shared/board"
import { drops } from "../databases/config"
import { type DropRow, MAX_FILE_BYTES, readText, storageFailure } from "./drops"
import type { Identity } from "./identity"
import { textStatements } from "./search"

// A board is one living file. Unlike a doc, whose versions never change, people and agents edit the latest version
// of a board in place, the way an app's next version replaces its files: a whiteboard changes stroke by stroke, and a
// version per stroke would bury its history. Publishing with `previous` still makes a new version to come back to.
//
// TODO(board-realtime): browsers send their changes here and poll for everyone else's. A Realtime room per board
// (like server/realtime/drops.ts for Markdown) would show other people's cursors and strokes as they draw.

export async function readBoard(drop: DropRow): Promise<BoardSnapshot> {
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
 * Applies records people put and removed in tldraw, or an agent's edit, to the board, and stores it. Each record is
 * checked against tldraw's schema first, so a broken client can't store a board tldraw then refuses to open.
 * Last writer wins per record: two people moving the same note keep the later move.
 */
export async function writeBoard(
  drop: DropRow,
  change: { put?: Record<string, unknown>[]; remove?: string[] } | { edit: BoardEdit; who: Identity },
) {
  const board = await readBoard(drop)
  let put: Record<string, unknown>[]
  let remove: string[]
  if ("edit" in change) {
    try {
      ;({ put, remove } = boardChanges(board, change.edit, change.who.actorName))
    } catch (error) {
      throw new HTTPError({ status: 400, message: error instanceof Error ? error.message : String(error) })
    }
  } else {
    // doctor-disable-next-line typescript/strict/no-runtime-typeof -- the request body is unchecked JSON; tldraw's schema checks each record below
    remove = (change.remove ?? []).filter((id) => typeof id === "string" && !SESSION.test(id))
    put = []
    for (const record of change.put ?? []) {
      // Cameras, pointers and selection are each person's own; only the document is shared.
      // doctor-disable-next-line typescript/strict/no-runtime-typeof -- the request body is unchecked JSON; validateRecord checks the rest
      if (typeof record.id !== "string" || SESSION.test(record.id)) continue
      try {
        // SAFETY: validateRecord checks the record against tldraw's schema and throws when it doesn't fit.
        put.push(validateRecord(record as never))
      } catch (error) {
        throw new HTTPError({
          status: 400,
          statusText: `Invalid record ${record.id}: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }
  // SAFETY: every record in put passed validateRecord or came from boardChanges, which validates its own.
  applyChanges(board, put as never, remove)
  const text = JSON.stringify(board)
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
  return { board, put: put.length, remove: remove.length, updatedAt: now }
}

const SESSION = /^(camera|instance|instance_page_state|pointer|instance_presence):/

// Images: the browser that saves a board renders the overview and each frame as PNG (tldraw only renders in a
// browser) and sends them here, so agents can look at drawings the outline can only locate.

const imageKey = (drop: DropRow, name: string) => `boards/${drop.link}/${name}.png`
export const OVERVIEW = "overview"

export async function storeBoardImages(drop: DropRow, images: { frame: string; png: string }[]) {
  const board = await readBoard(drop)
  const frames = new Set(boardFrames(board).map((frame) => frame.id))
  for (const image of images) {
    if (image.frame !== OVERVIEW && !frames.has(image.frame)) continue
    const bytes = Uint8Array.from(atob(image.png), (char) => char.charCodeAt(0))
    // A PNG starts with these 8 bytes; anything else isn't stored.
    if (bytes.byteLength > MAX_FILE_BYTES || bytes[0] !== 0x89 || bytes[1] !== 0x50) continue
    const [error] = await blob.put(imageKey(drop, image.frame), bytes, { access: "private", contentType: "image/png" })
    if (error) throw storageFailure(error)
  }
}

/** The stored PNG of the overview or a frame, base64-encoded for an MCP image result, or null before any was sent. */
export async function boardImage(drop: DropRow, frame: string) {
  const [error, file] = await blob.get(imageKey(drop, frame))
  if (error?.code === "BLOB_NOT_FOUND" || !file) return null
  if (error) throw storageFailure(error)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
