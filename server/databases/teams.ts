import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

// Teams on a personal Drop (server/utils/teams.ts): Better Auth's organization plugin keeps who is on which team, and
// its Stripe plugin keeps each team's subscription. A team's drops live in its team folders (`drops.team_id`).

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull()

export const organization = sqliteTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("organization_slug_idx").on(table.slug)],
)

/** Who is on a team: `owner` (made it, pays for it), `admin` (manages its folders and people), or `member`. */
export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("member_organization_idx").on(table.organizationId),
    uniqueIndex("member_user_organization_idx").on(table.userId, table.organizationId),
  ],
)

/** An invitation by email. Drop sends no mail: whoever invites copies the link, and the invitee signs in with that email. */
export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    teamId: text("team_id"),
    status: text("status").notNull().default("pending"),
    inviterId: text("inviter_id").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("invitation_organization_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
)

/** A team's Stripe subscription, written by the Stripe plugin from Stripe's webhooks. `referenceId` is the team. */
export const subscription = sqliteTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    referenceId: text("reference_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").default("incomplete"),
    periodStart: integer("period_start", { mode: "timestamp_ms" }),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }),
    trialStart: integer("trial_start", { mode: "timestamp_ms" }),
    trialEnd: integer("trial_end", { mode: "timestamp_ms" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).default(false),
    cancelAt: integer("cancel_at", { mode: "timestamp_ms" }),
    canceledAt: integer("canceled_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    seats: integer("seats"),
    billingInterval: text("billing_interval"),
    stripeScheduleId: text("stripe_schedule_id"),
  },
  (table) => [index("subscription_reference_idx").on(table.referenceId)],
)
