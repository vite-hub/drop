import { apiKey } from "@better-auth/api-key"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { eq } from "drizzle-orm"
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
 * Anyone with a GitHub account can sign in and joins as a member: their drops are private to them until they
 * share them. The GitHub users listed in `DROP_ADMINS` (numeric ids, from `gh api users/<login> --jq .id`) become
 * admins when their account is created; admins can make anyone else an editor or an admin on the Members page.
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
    github: { clientId: env.auth.github.clientId.unseal(), clientSecret: env.auth.github.clientSecret.unseal() },
  },
  emailAndPassword: { enabled: import.meta.dev === true },
  account: { accountLinking: { enabled: true, trustedProviders: ["github"] } },
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          if (account.providerId !== "github") return
          const admins = env.drop.admins.unseal().split(/[\s,]+/).filter(Boolean)
          if (admins.includes(account.accountId)) await db.update(users).set({ role: "admin" }).where(eq(users.id, account.userId))
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
