import { log } from "evlog"
import { useWorkspace } from "vite-hub/workspace"
import { draftPath } from "../utils/draft-paths"

/**
 * Live drafts: the text people edit together, in the `drafts` Workspace (server/workspaces/drafts.ts). One file per
 * drop version, `drafts/<id>.md`, holding the body without front matter. Its Realtime room (server/realtime/drops.ts)
 * loads from the file and checkpoints back into it; publishing turns it into the next version.
 * Hosts without Realtime get ./unavailable.ts instead (nuxt.config.ts `#live-drafts`).
 */

const drafts = () => useWorkspace("drafts", { mode: "write" })

/** Creates the draft from the published body unless one exists. Returns the Workspace path the room edits. */
export async function ensureDraft(id: string, body: string) {
  const workspace = drafts()
  const path = draftPath(id)
  if (await workspace.fs.exists(path)) return path
  await workspace.fs.writeFile(path, body, { mediaType: "text/markdown" })
  await workspace.history.checkpoint({ message: `Draft ${id}` })
  return path
}

export async function readDraft(id: string) {
  const workspace = drafts()
  const path = draftPath(id)
  return await workspace.fs.exists(path) ? String(await workspace.fs.readFile(path)) : null
}

/** Drops drafts that no room continues (a published or deleted version). Best effort: a stray file costs a few bytes. */
export async function deleteDrafts(ids: string[]) {
  if (!ids.length) return
  try {
    const workspace = drafts()
    let removed = false
    for (const id of ids) {
      if (!await workspace.fs.exists(draftPath(id))) continue
      await workspace.fs.rm(draftPath(id))
      removed = true
    }
    if (removed) await workspace.history.checkpoint({ message: "Remove drafts" })
  }
  catch (error) {
    log.warn({ action: "draft-cleanup", drops: ids.join(","), error: String(error) })
  }
}
