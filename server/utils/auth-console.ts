import { sql } from "drizzle-orm"
import { db } from "vite-hub/database"

/** The user's Drops list: no folders, embedded files, or Trash. One bind even for 100 users. */
export async function countDropsByUser(userIds: readonly string[]): Promise<Record<string, number>> {
  if (!userIds.length) return {}
  const counts = await db.all<{ id: string; drops: number }>(sql`
    SELECT ids.value AS id,
      (SELECT count(*) FROM drops d
       WHERE d.owner_id = ids.value AND d.kind != 'folder' AND d.trashed_at IS NULL
       AND (d.parent_id IS NULL OR EXISTS (SELECT 1 FROM drops p WHERE p.id = d.parent_id AND p.kind = 'folder'))) AS drops
    FROM json_each(${JSON.stringify(userIds)}) ids
  `)
  return Object.fromEntries(counts.map((row) => [row.id, row.drops]))
}

/** Display the switches that configure sign-in. ViteHub Auth adds its own line for `VITEHUB_MEMBERS`. */
export function authAccessLines(config: { proxied: boolean; password: boolean }) {
  return [
    config.proxied ? "Sign-in uses the deployment's GitHub oauth2-proxy." : "Sign-in uses GitHub.",
    ...(config.password ? ["Email and password sign-in is enabled for local development or runtime tests."] : []),
  ]
}
