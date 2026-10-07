// Three roles on Better Auth's admin plugin (role field + createAccessControl). Everyone who signs in joins as
// Member; the GitHub users in DROP_ADMINS join as Admin.
export type Role = "admin" | "editor" | "member";

export const ROLES: Role[] = ["admin", "editor", "member"];
export const DEFAULT_ROLE: Role = "member";

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", editor: "Editor", member: "Member" };

export const ROLE_SUMMARY: Record<Role, string> = {
  admin: "Everything, plus members and settings.",
  editor: "Edit and share any drop in the workspace.",
  member: "Create, share, and comment on their own drops."
};

export const isRole = (value: string): value is Role => (ROLES as string[]).includes(value);
