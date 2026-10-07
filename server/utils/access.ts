import { createAccessControl } from "better-auth/plugins/access"
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access"

/**
 * Three roles, no configuration (see shared/roles.ts for how they read in the UI).
 * Admin: everything, plus members. Editor: edit and share any drop. Member: their own drops.
 */
const statement = { ...defaultStatements, drop: ["edit-any", "share-any"] } as const

export const ac = createAccessControl(statement)

export const roles = {
  admin: ac.newRole({ ...adminAc.statements, drop: ["edit-any", "share-any"] }),
  editor: ac.newRole({ drop: ["edit-any", "share-any"] }),
  member: ac.newRole({ drop: [] }),
}
