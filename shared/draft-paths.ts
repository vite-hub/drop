export const draftPath = (id: string, version: number) => `drafts/${id}/v${version}.md` as const

export function draftOf(path: string) {
  const match = path.match(/^drafts\/([0-9a-z]{12})\/v(\d+)\.md$/)
  return match ? { id: match[1]!, version: Number(match[2]) } : null
}
