import { HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { isRealtimeAvailable, refreshRealtimeDocument } from "vite-hub/realtime/server"
import { draftPath } from "#shared/draft-paths"
import { background } from "./logs"

export const LIVE_EDITING = isRealtimeAvailable()

async function read(key: string) {
  const [error, file] = await blob.get(key)
  if (error?.code === "BLOB_NOT_FOUND") return null
  if (error) throw error
  return file ? file.text() : null
}

type Version = { id: string; version: number }

export async function ensureDraft(drop: Version, body: string) {
  if (!LIVE_EDITING) throw new HTTPError({ status: 404, statusText: "Live editing isn't available on this host." })
  const path = draftPath(drop.id, drop.version)
  if ((await read(path)) === null) {
    const [error] = await blob.put(path, body, { contentType: "text/markdown; charset=utf-8" })
    if (error) throw error
  }
  return path
}

export const readDraft = async (drop: Version) => (LIVE_EDITING ? read(draftPath(drop.id, drop.version)) : null)

export async function deleteDrafts(drops: Version[]) {
  if (!drops.length) return
  const paths = drops.map((drop) => draftPath(drop.id, drop.version))
  const [error] = await blob.delete(paths)
  if (error) background.warn({ action: "draft-cleanup", drafts: paths.join(","), error: String(error) })
}

export async function refreshLatest(id: string) {
  await refreshRealtimeDocument("latest", id)
}
