import * as v from "valibot"
import type { PrivateEmbed } from "#shared/types"

export const PrivateEmbedsSchema = v.optional(
  v.array(
    v.object({
      doc: v.object({ id: v.string(), title: v.string() }),
      link: v.string(),
      title: v.nullable(v.string()),
    }),
  ),
)

const named = ({ title }: PrivateEmbed) => (title === null ? "a drop you can't open" : `"${title}"`)

export function privateEmbedsNotice(embeds: PrivateEmbed[]) {
  const docs = [...new Set(embeds.map(({ doc }) => doc.title))]
  const where = docs.length === 1 ? `"${docs[0]}"` : `${docs.length} docs`
  if (embeds.length === 1)
    return {
      title: `People with the public link can't see ${named(embeds[0]!)}`,
      description: `${where} embeds it, but it isn't shared with them. Share it the same way, or remove the embed.`,
    }
  const listed = embeds.slice(0, 3).map(named).join(", ")
  const more = embeds.length > 3 ? ` and ${embeds.length - 3} more` : ""
  return {
    title: `People with the public link can't see ${embeds.length} embedded drops`,
    description: `${where} embeds ${listed}${more}, which aren't shared with them. Share them the same way, or remove the embeds.`,
  }
}
