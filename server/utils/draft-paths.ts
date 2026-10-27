/** Where a drop version's live draft lives in Blob, which is also its Realtime room's id. */
export const draftPath = (id: string, version: number) => `drafts/${id}/v${version}.md` as const

/** The drop and version a Realtime room or draft path belongs to, or null for anything else. */
export function draftOf(path: string) {
  const match = path.match(/^drafts\/([0-9a-z]{12})\/v(\d+)\.md$/)
  return match ? { id: match[1]!, version: Number(match[2]) } : null
}
