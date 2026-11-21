import * as v from "valibot"

const AUTHOR_KEY = "drop-comments-author"
const AuthorSchema = v.object({ id: v.string() })

export function readOutboxAuthor() {
  try {
    const parsed = v.safeParse(AuthorSchema, JSON.parse(localStorage.getItem(AUTHOR_KEY) ?? "null"))
    return parsed.success ? parsed.output.id : undefined
  } catch {
    return undefined
  }
}

export function writeOutboxAuthor(id?: string) {
  try {
    if (id) localStorage.setItem(AUTHOR_KEY, JSON.stringify({ id }))
    else localStorage.removeItem(AUTHOR_KEY)
  } catch {
    // A storage failure doesn't change ownership of the saved entries.
  }
}
