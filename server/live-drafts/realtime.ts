import { log } from "evlog"
import { blob } from "vite-hub/blob"
import { blobDocument, refreshRealtimeDocument } from "vite-hub/realtime/server"
import { draftPath } from "#shared/draft-paths"

/**
 * Live drafts: the text people edit together, one Blob file per drop version (`drafts/<id>/v<n>.md`) holding the body
 * without front matter. Its Realtime room (server/realtime/drops.ts) loads from the file and saves back into it a
 * couple of seconds after people stop typing; publishing turns it into the next version and deletes it. Drafts have
 * no history of their own: the drop's versions are its history. `/f/` never serves them (utils/content-access.ts).
 * Hosts without Realtime get ./unavailable.ts instead (nuxt.config.ts `#live-drafts`).
 */

export const LIVE_EDITING = true

async function read(key: string) {
  const [error, file] = await blob.get(key)
  if (error?.code === "BLOB_NOT_FOUND") return null
  if (error) throw error
  return file ? file.text() : null
}

async function write(key: string, body: string) {
  const [error] = await blob.put(key, body, { access: "private", contentType: "text/markdown; charset=utf-8" })
  if (error) throw error
}

/** Where a room's document lives. Its id is the draft's Blob key; `authorize` only admits `drafts/<id>.md`. */
export const draftDocument = blobDocument(blob)

type Version = { id: string; version: number }

/** Creates the draft from the published body unless one exists. Returns its path, which is also its room's id. */
export async function ensureDraft(drop: Version, body: string) {
  const path = draftPath(drop.id, drop.version)
  if ((await read(path)) === null) await write(path, body)
  return path
}

export const readDraft = (drop: Version) => read(draftPath(drop.id, drop.version))

/** Drops drafts that no room continues (a published or deleted version). Best effort: a stray file costs a few bytes. */
export async function deleteDrafts(drops: Version[]) {
  if (!drops.length) return
  const paths = drops.map((drop) => draftPath(drop.id, drop.version))
  const [error] = await blob.del(paths)
  if (error) log.warn({ action: "draft-cleanup", drafts: paths.join(","), error: String(error) })
}

/** Tells the people reading a drop's link that it has a new latest version (server/realtime/latest.ts). Never throws. */
export async function refreshLatest(id: string) {
  await refreshRealtimeDocument("latest", id)
}
