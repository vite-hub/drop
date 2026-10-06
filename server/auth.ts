import { apiKey } from "@better-auth/api-key"
import { APIError } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { count } from "drizzle-orm"
import { defineAuth } from "vite-hub/auth"
import { db, schema } from "vite-hub/database/drizzle"
import { user as users } from "./databases/config"
import { ac, roles } from "./utils/access"

/**
 * Who can sign in, and how.
 *
 * Drop signs in with GitHub. To use another provider, swap `socialProviders` (Google, GitLab, Discord…),
 * or add `emailAndPassword: { enabled: true }`, then set its secrets in nuxt.config.ts `vite.env.server.auth`.
 *
 * The first person to sign in becomes the admin. After that, Drop is invite-only: an admin adds people
 * on the Members page, and they sign in with the same email.
 *
 * Local dev has no GitHub OAuth app, so email and password sign-in is on in `nuxt dev` only.
 * Agents send their API key as `Authorization: Bearer drop_…` (MCP) or `x-api-key: drop_…` (curl).
 *
 * Keep comments outside the options object: ViteHub reads its top-level keys statically.
 */
export default defineAuth(({ env, requestOrigin }) => ({
  appName: "Drop",
  baseURL: requestOrigin,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  secret: env.auth.secret.unseal(),
  route: false,
  access: { signIn: { callbackURL: "/drops", errorCallbackURL: "/?auth_error=1", provider: "github" } },
  socialProviders: {
    github: { clientId: env.auth.github.clientId, clientSecret: env.auth.github.clientSecret.unseal() },
  },
  emailAndPassword: { enabled: import.meta.dev },
  account: { accountLinking: { enabled: true, trustedProviders: ["github"] } },
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          const [row] = await db.select({ total: count() }).from(users)
          if (!row?.total) return { data: { ...user, role: "admin" } }
          if (context?.path?.startsWith("/admin/")) return { data: user }
          throw new APIError("FORBIDDEN", { message: "Drop is invite-only. Ask an admin to add your email." })
        },
      },
    },
  },
  plugins: [
    admin({ ac, roles, defaultRole: "member", adminRoles: ["admin"] }),
    apiKey({
      defaultPrefix: "drop_",
      enableSessionForAPIKeys: true,
      customAPIKeyGetter: (ctx) => {
        const header = ctx.headers?.get("x-api-key") ?? ctx.headers?.get("authorization")?.replace(/^Bearer\s+/i, "")
        return header?.startsWith("drop_") ? header : null
      },
      rateLimit: { enabled: false },
    }),
  ],
}))
