import { createAccessControl } from "better-auth/plugins/access"
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access"

/** Two roles, no configuration (see shared/roles.ts). Admin: everything, plus members. Member: everything else. */
const statement = { ...defaultStatements } as const

export const ac = createAccessControl(statement)

export const roles = {
  admin: ac.newRole({ ...adminAc.statements }),
  member: ac.newRole({}),
}
