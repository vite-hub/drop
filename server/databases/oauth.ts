// Better Auth OAuth provider + JWT plugin tables: MCP clients sign people in through Drop (OAuth 2.1).
// Generated from the plugins' own schema (better-auth/db getAuthTables); arrays and JSON are stored as text.
// Foreign keys live in migration 0002 only: the adapter doesn't need them, and declaring them here would cycle with config.ts.
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  alg: text("alg"),
  crv: text("crv"),
})

export const oauthClient = sqliteTable("oauth_client", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientDiscoveryId: text("client_discovery_id"),
  disabled: integer("disabled", { mode: "boolean" }),
  skipConsent: integer("skip_consent", { mode: "boolean" }),
  enableEndSession: integer("enable_end_session", { mode: "boolean" }),
  subjectType: text("subject_type"),
  scopes: text("scopes"),
  clientCredentialsScopes: text("client_credentials_scopes"),
  userId: text("user_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts"),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris"),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  backchannelLogoutSessionRequired: integer("backchannel_logout_session_required", { mode: "boolean" }),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  applicationType: text("application_type"),
  jwks: text("jwks"),
  jwksUri: text("jwks_uri"),
  grantTypes: text("grant_types"),
  responseTypes: text("response_types"),
  requirePKCE: integer("require_pkce", { mode: "boolean" }),
  dpopBoundAccessTokens: integer("dpop_bound_access_tokens", { mode: "boolean" }),
  referenceId: text("reference_id"),
  metadata: text("metadata"),
}, table => [index("oauth_client_user_id_idx").on(table.userId)])

export const oauthResource = sqliteTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes"),
  customClaims: text("custom_claims"),
  dpopBoundAccessTokensRequired: integer("dpop_bound_access_tokens_required", { mode: "boolean" }),
  disabled: integer("disabled", { mode: "boolean" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  policyVersion: integer("policy_version"),
  metadata: text("metadata"),
})

export const oauthClientResource = sqliteTable("oauth_client_resource", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  resourceId: text("resource_id").notNull(),
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
}, table => [index("oauth_client_resource_client_id_idx").on(table.clientId), index("oauth_client_resource_resource_id_idx").on(table.resourceId)])

export const oauthRefreshToken = sqliteTable("oauth_refresh_token", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull(),
  sessionId: text("session_id"),
  userId: text("user_id").notNull(),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources"),
  requestedUserInfoClaims: text("requested_user_info_claims"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  revoked: integer("revoked", { mode: "timestamp_ms" }),
  rotatedAt: integer("rotated_at", { mode: "timestamp_ms" }),
  rotationReplayResponse: text("rotation_replay_response"),
  rotationReplayExpiresAt: integer("rotation_replay_expires_at", { mode: "timestamp_ms" }),
  authTime: integer("auth_time", { mode: "timestamp_ms" }),
  confirmation: text("confirmation"),
  scopes: text("scopes").notNull(),
}, table => [index("oauth_refresh_token_client_id_idx").on(table.clientId), index("oauth_refresh_token_session_id_idx").on(table.sessionId), index("oauth_refresh_token_user_id_idx").on(table.userId), index("oauth_refresh_token_authorization_code_id_idx").on(table.authorizationCodeId)])

export const oauthAccessToken = sqliteTable("oauth_access_token", {
  id: text("id").primaryKey(),
  token: text("token").unique(),
  clientId: text("client_id").notNull(),
  sessionId: text("session_id"),
  userId: text("user_id"),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources"),
  requestedUserInfoClaims: text("requested_user_info_claims"),
  refreshId: text("refresh_id"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  revoked: integer("revoked", { mode: "timestamp_ms" }),
  confirmation: text("confirmation"),
  scopes: text("scopes").notNull(),
}, table => [index("oauth_access_token_client_id_idx").on(table.clientId), index("oauth_access_token_session_id_idx").on(table.sessionId), index("oauth_access_token_user_id_idx").on(table.userId), index("oauth_access_token_authorization_code_id_idx").on(table.authorizationCodeId), index("oauth_access_token_refresh_id_idx").on(table.refreshId)])

export const oauthConsent = sqliteTable("oauth_consent", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  userId: text("user_id"),
  referenceId: text("reference_id"),
  resources: text("resources"),
  requestedUserInfoClaims: text("requested_user_info_claims"),
  scopes: text("scopes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
}, table => [index("oauth_consent_client_id_idx").on(table.clientId), index("oauth_consent_user_id_idx").on(table.userId)])

export const oauthClientAssertion = sqliteTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
})
