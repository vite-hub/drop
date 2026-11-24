import * as v from "valibot"
import type { PrivateEmbed, UncheckedEmbeds } from "#shared/types"

export const EmbedCheckSchema = {
  privateEmbeds: v.optional(
    v.array(
      v.object({
        doc: v.object({ id: v.string(), title: v.string() }),
        link: v.string(),
        title: v.nullable(v.string()),
      }),
    ),
  ),
  uncheckedEmbeds: v.optional(v.object({ docs: v.number(), embeds: v.number() })),
  embedCheckFailed: v.optional(v.boolean()),
}

export interface EmbedCheck {
  privateEmbeds?: PrivateEmbed[]
  uncheckedEmbeds?: UncheckedEmbeds
  embedCheckFailed?: boolean
}

const named = ({ title }: PrivateEmbed) => (title === null ? "a drop you can't open" : `"${title}"`)

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

function partial(unchecked: UncheckedEmbeds | undefined) {
  if (!unchecked) return ""
  const parts = [
    ...(unchecked.docs ? [plural(unchecked.docs, "doc")] : []),
    ...(unchecked.embeds ? [plural(unchecked.embeds, "embed")] : []),
  ]
  return `The check was partial: ${parts.join(" and ")} weren't checked.`
}

export function privateEmbedsNotice({ privateEmbeds: embeds = [], uncheckedEmbeds, embedCheckFailed }: EmbedCheck) {
  if (embedCheckFailed)
    return {
      title: "Embeds weren't checked",
      description:
        "The change is saved, but Drop couldn't check whether people with the public link can open what the doc embeds. Open the doc to check.",
    }
  const rest = partial(uncheckedEmbeds)
  if (!embeds.length) return rest ? { title: "Some embeds weren't checked", description: rest } : null
  const docs = [...new Set(embeds.map(({ doc }) => doc.title))]
  const where = docs.length === 1 ? `"${docs[0]}"` : `${docs.length} docs`
  const after = rest ? ` ${rest}` : ""
  if (embeds.length === 1 && embeds[0]!.title === null)
    return {
      title: "People with the public link can't see a drop you can't open",
      description: `${where} embeds it. Remove the embed, or ask its owner to share it the same way.${after}`,
    }
  if (embeds.length === 1)
    return {
      title: `People with the public link can't see ${named(embeds[0]!)}`,
      description: `${where} embeds it, but it isn't shared with them. Share it the same way, or remove the embed.${after}`,
    }
  const listed = embeds.slice(0, 3).map(named).join(", ")
  const more = embeds.length > 3 ? ` and ${embeds.length - 3} more` : ""
  return {
    title: `People with the public link can't see ${embeds.length} embedded drops`,
    description: `${where} embeds ${listed}${more}, which aren't shared with them. Share them the same way, or remove the embeds.${after}`,
  }
}
