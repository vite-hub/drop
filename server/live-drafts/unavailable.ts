import { HTTPError } from "h3"

// Hosts without Realtime rooms (Vercel, Netlify, Deno) have no live editor, so they have no drafts either.

export async function ensureDraft(_id: string, _body: string): Promise<string> {
  throw new HTTPError({ status: 404, statusText: "Live editing isn't available on this host." })
}

export async function readDraft(_id: string): Promise<string | null> {
  return null
}

export async function deleteDrafts(_ids: string[]) {}
