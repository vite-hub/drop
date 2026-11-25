import { APIError } from "better-auth/api"
import { defineErrorCatalog } from "evlog"
import { HTTPError } from "h3"

const membershipUnavailable = "GitHub membership verification is unavailable. Try again shortly."
const reauth = "GitHub sign-in expired or was revoked. Sign in again to Drop."

const entries = {
  SIGN_IN_REQUIRED: { status: 401, message: "Sign in, or connect your agent through Drop's MCP server." },
  ADMIN_REQUIRED: { status: 403, message: "Only admins, in the browser, can do that." },
  SENDER_CHANGED: { status: 401, message: "Sign in again to send this comment." },
  DOCUMENT_SIGN_IN_REQUIRED: { status: 401, message: "Sign in to open the document." },
  REVIEW_SIGN_IN_REQUIRED: { status: 401, message: "Sign in to open the review." },
  AUTH_GITHUB_UNAVAILABLE: { status: 503, message: membershipUnavailable },
  GITHUB_REAUTH_REQUIRED: { status: 401, message: reauth },
  GITHUB_ORG_ACCESS_REQUIRED: {
    status: 403,
    message:
      "GitHub organization access could not be verified. Reauthorize Drop with read:org and any required organization SSO access.",
  },
  GITHUB_MEMBERSHIP_UNAVAILABLE: { status: 503, message: membershipUnavailable },
  GITHUB_MEMBERSHIP_REQUIRED: { status: 403, message: "Active organization membership required." },
  GITHUB_IDENTITY_UNAVAILABLE: { status: 503, message: "GitHub identity is unavailable. Try again shortly." },
  PROXY_SIGN_IN_FAILED: { status: 403, message: "Proxy sign-in failed." },
} as const

export const authErrors = defineErrorCatalog("auth", entries)

export type AuthErrorCode = keyof typeof entries

export function authError(code: AuthErrorCode) {
  const { status, message } = authErrors[code]
  return new HTTPError({ status, statusText: message, data: { code } })
}

export function authApiError(code: AuthErrorCode) {
  const { status, message } = authErrors[code]
  return new APIError(status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "SERVICE_UNAVAILABLE", {
    message,
    code,
  })
}

export const isAuthErrorCode = (code: unknown): code is AuthErrorCode =>
  typeof code === "string" && Object.hasOwn(entries, code)
