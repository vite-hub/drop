import { sql } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { user as users } from "../databases/config"
import { useServerEnv } from "#vitehub/env/server"
import { roleFor, ROLES } from "#shared/roles"

/** Console labels and its Admins filter read stored roles, including accounts that have not signed in recently. */
export async function syncConsoleRoles() {
  const env = useServerEnv()
  const admins = env.drop.admins.unseal()
  const trustUnverified = import.meta.dev === true || env.drop.testSignin
  const rows = await db
    .select({ id: users.id, email: users.email, emailVerified: users.emailVerified, role: users.role })
    .from(users)
  for (const role of ROLES) {
    const ids = rows
      .filter((row) => row.role !== role && roleFor(row, admins, trustUnverified) === role)
      .map((row) => row.id)
    if (ids.length)
      await db
        .update(users)
        .set({ role })
        .where(sql`${users.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`)
  }
}

/** The user's Drops list: latest versions, no folders, embedded files, or Trash. One bind even for 100 users. */
export async function countDropsByUser(userIds: readonly string[]): Promise<Record<string, number>> {
  if (!userIds.length) return {}
  const counts = await db.all<{ id: string; drops: number }>(sql`
    SELECT ids.value AS id,
      (SELECT count(*) FROM drop_heads h JOIN drops d ON d.id = h.drop_id
       WHERE h.owner_id = ids.value AND d.kind != 'folder' AND d.trashed_at IS NULL
       AND (d.parent_id IS NULL OR EXISTS (SELECT 1 FROM drops p WHERE p.id = d.parent_id AND p.kind = 'folder'))) AS drops
    FROM json_each(${JSON.stringify(userIds)}) ids
  `)
  return Object.fromEntries(counts.map((row) => [row.id, row.drops]))
}

/** Display the same switches that configure sign-in; never disclose the email allowlist. */
export function authAccessLines(config: {
  members: boolean
  organization: string
  proxied: boolean
  password: boolean
}) {
  return [
    config.members
      ? "DROP_MEMBERS is on: only listed verified emails and DROP_ADMINS can sign in."
      : "DROP_MEMBERS is off: there is no email allowlist.",
    config.organization
      ? `Active membership of the GitHub organization ${config.organization} is required on every request.`
      : "No GitHub organization membership is required.",
    config.proxied ? "Sign-in uses the deployment's GitHub oauth2-proxy." : "Sign-in uses GitHub.",
    ...(config.password ? ["Email and password sign-in is enabled for local development or runtime tests."] : []),
  ]
}
