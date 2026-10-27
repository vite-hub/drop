import { HTTPError } from "h3"

// Hosts without Realtime rooms (Vercel, Netlify, Deno) have no live editor, so they have no drafts either.

export const LIVE_EDITING = false

export async function ensureDraft(_drop: { id: string; version: number }, _body: string): Promise<string> {
  throw new HTTPError({ status: 404, statusText: "Live editing isn't available on this host." })
}

export async function readDraft(_drop: { id: string; version: number }): Promise<string | null> {
  return null
}

export async function deleteDrafts(_drops: { id: string; version: number }[]) {}

// Without rooms, readers find a new version when they open the link again.
export async function refreshLatest(_id: string) {}
