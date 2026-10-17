/** Where a drop version's live draft lives in Blob, which is also its Realtime room's id. */
export const draftPath = (id: string) => `drafts/${id}.md` as const

/** The drop id a Realtime room or draft path belongs to, or null for anything else. */
export function draftDropId(path: string) {
  return path.match(/^drafts\/([0-9a-f-]{36})\.md$/)?.[1] ?? null
}
