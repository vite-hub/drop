const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
const LINK_LENGTH = 12
export const MAX_SLUG = 60

export function newLink() {
  const bytes = crypto.getRandomValues(new Uint8Array(LINK_LENGTH))
  return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("")
}

export function slugify(text: string) {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (words.length <= MAX_SLUG) return words
  const cut = words.slice(0, MAX_SLUG + 1)
  return (cut.includes("-") ? cut.slice(0, cut.lastIndexOf("-")) : cut.slice(0, MAX_SLUG)).replace(/-+$/, "")
}

export const DROP_PAGE_PARAMS = ["v", "comment", "changes", "present", "from", "edit", "path", "file"]

export const dropPath = (drop: { link: string; slug: string }, version?: number) =>
  `/d/${drop.link}${drop.slug ? `/${drop.slug}` : ""}${version ? `?v=${version}` : ""}`

export const HUB_SKILLS_PATH = /^\/d\/([^/]+)(?:\/[^/]+)?(?=\/\.well-known\/(?:agent-skills|skills)\/)/

export const skillsAddCommand = (origin: string, hub: { link: string; slug: string; skill?: string }) =>
  `npx skills add ${origin}${dropPath(hub)}${hub.skill ? ` --skill ${hub.skill}` : ""}`

export interface DropLink {
  id: string
  link: string
  slug: string
  version: number
  latest: number
  from?: number
}
