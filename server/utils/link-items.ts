import type { AgentMetadata } from "#shared/agent"
import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database"
import { newLink, slugify } from "#shared/links"
import { linkSource, MAX_RESOURCE_URL, pullRequestOf, resourceUrl } from "#shared/resources"
import { defaultShare, isPublic, type Share } from "#shared/share"
import { drops } from "../databases/default/index"
import { type DropRow, lifetimeFields, type LifetimeInput } from "./drops"
import type { Identity } from "./identity"
import { logDrop } from "./logs"
import { touchFolder, uniqueSlug } from "./nodes"
import { requireKeepSlot, withDropQuota } from "./quotas"
import { modeFor, shareFields } from "./share"
import { shareReviewFor } from "./trust"

export function linkAddress(url: string) {
  const href = url.length <= MAX_RESOURCE_URL ? resourceUrl(url) : null
  if (!href) throw new HTTPError({ status: 400, message: `${url} isn't a link: use https, or http on localhost.` })
  return href
}

const PullRequest = v.object({ title: v.string() })

async function pullRequestTitle(href: string): Promise<string | null> {
  const pull = pullRequestOf(href)
  if (!pull) return null
  try {
    const response = await fetch(`https://api.github.com/repos/${pull.repo}/pulls/${pull.number}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "vitehub-drop" },
      signal: AbortSignal.timeout(3000),
    })
    const parsed = response.ok ? v.safeParse(PullRequest, await response.json()) : null
    return parsed?.success ? parsed.output.title.trim() || null : null
  } catch {
    return null
  }
}

const linkTitle = async (href: string, title?: string) =>
  (title?.trim() || (await pullRequestTitle(href)) || linkSource(href)).slice(0, 160)

export async function createLinkDrop(
  who: Identity,
  input: LifetimeInput & {
    agent?: AgentMetadata
    url: string
    title?: string
    slug?: string
    share?: Share
    folder?: DropRow
  },
  event?: H3Event,
) {
  const href = linkAddress(input.url)
  const folder = input.folder ?? null
  const ownerId = folder && !folder.teamFolder ? folder.ownerId : who.userId
  const life = folder ? lifetimeFields(who, {}, folder, event) : lifetimeFields(who, input, null, event)
  await requireKeepSlot(ownerId, life, false, !folder)
  const mode = modeFor(folder, event)
  const { share, publicUntil } = input.share
    ? shareFields(input.share, { kind: "link", team: mode === "team" }, event)
    : { share: defaultShare(mode), publicUntil: null }
  const title = await linkTitle(href, input.title)
  return withDropQuota(ownerId, { drops: 1, bytes: 0, writes: 0 }, event, async (quota) => {
    const now = Date.now()
    const row: DropRow = {
      id: newLink(),
      ownerId,
      kind: "link",
      title,
      filename: new URL(href).hostname,
      blobKey: null,
      contentType: null,
      size: 0,
      version: 1,
      slug: await uniqueSlug(folder?.id ?? null, (input.slug && slugify(input.slug)) || slugify(title)),
      share,
      publicUntil,
      teamFolder: false,
      shareReview: isPublic(share) ? await shareReviewFor(ownerId, event) : null,
      quarantinedAt: null,
      actorKind: who.actorKind,
      actorName: who.actorName,
      agent: who.actorKind === "agent" ? (input.agent ?? null) : null,
      sessionPublisherId: who.actorKind === "agent" && input.agent?.session ? who.userId : null,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      ...life,
      note: input.note?.trim() || null,
      trashedAt: null,
      trashReason: null,
      parentId: folder?.id ?? null,
      siteUrl: href,
      publishToken: null,
      draftImage: false,
      teamId: null,
      resources: null,
    }
    await quota.commit([db.insert(drops).values(row), ...(folder ? [touchFolder(folder.id, now)] : [])])
    logDrop(event, row, { change: "create" })
    return row
  })
}
