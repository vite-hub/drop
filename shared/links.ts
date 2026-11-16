// A doc's share link: `/d/<link>/<slug>`. The link is a short random key every version of the doc shares, so the link
// always opens the latest version; `?v=<n>` pins one. The slug is only there to read well: a wrong or outdated slug
// still opens the doc, and the page moves to the current one.

/** Crockford's base32, lowercase: no i, l, o or u to misread. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
const LINK_LENGTH = 12
export const MAX_SLUG = 60

/** A new link key: 12 characters, 60 random bits. Like a drop's id, it's the key to a shared drop. */
export function newLink() {
  const bytes = crypto.getRandomValues(new Uint8Array(LINK_LENGTH))
  return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("")
}

/** `Hipoteca de 75.000 € a 10 años` → `hipoteca-de-75-000-a-10-anos`. Empty when nothing readable is left. */
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

/**
 * The query keys a drop's page reads itself: a pinned version, an open thread, a diff, the present window, the version an
 * old link pointed at, the editor, and an app page (`path`, or `file` from older links). Any other key in a path under an
 * app's link is the app's own (`/d/<link>/<slug>/search?q=x`).
 */
export const DROP_PAGE_PARAMS = ["v", "comment", "changes", "present", "from", "edit", "path", "file"]

/** The doc's page: its latest version, or `version` pinned. */
export const dropPath = (drop: { link: string; slug: string }, version?: number) =>
  `/d/${drop.link}${drop.slug ? `/${drop.slug}` : ""}${version ? `?v=${version}` : ""}`

/**
 * Agent Skills Discovery under a folder's link (server/utils/hub-skills.ts): `/d/<link>[/<slug>]/.well-known/agent-skills/…`
 * or `…/.well-known/skills/…`, any slug or none. The match is the prefix the discovery folders start at; group 1 the link.
 */
export const HUB_SKILLS_PATH = /^\/d\/([^/]+)(?:\/[^/]+)?(?=\/\.well-known\/(?:agent-skills|skills)\/)/

/** The command that installs a hub's skills from `origin`, or one of them when `skill` names it. */
export const skillsAddCommand = (origin: string, hub: { link: string; slug: string; skill?: string }) =>
  `npx skills add ${origin}${dropPath(hub)}${hub.skill ? ` --skill ${hub.skill}` : ""}`

/** What `/api/links/:key` answers: the version to show, where the doc lives, and the version an old link pointed at. */
export interface DropLink {
  id: string
  link: string
  slug: string
  version: number
  latest: number
  from?: number
}
