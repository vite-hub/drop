/**
 * The key of every cached request (useApi, useAsyncData), named once so refreshNuxtData and useNuxtData hit the same
 * entry the fetch filled. One key is one request with one set of options: a second caller shares the composable.
 */
export const keys = {
  me: "me",
  signIn: "sign-in",
  drops: "drops",
  sharedWithMe: "shared-with-me",
  trash: "trash",
  usage: "usage",
  /** Every folder you may move a drop into (MoveModal). */
  folders: "folders",
  search: "search",
  dropSearch: "drop-search",
  members: "members",
  agents: "agents",
  skills: "skills",
  mcpCatalog: "mcp-catalog",
  oauthClient: "oauth-client",
  abuseContact: "abuse-contact",
  adminReports: "admin-reports",
  adminReview: "admin-review",
  drop: (id: string) => `drop:${id}`,
  comments: (id: string) => `comments:${id}`,
  /** The drops directly in a folder. */
  folder: (id: string) => `folder:${id}`,
  folderSearch: (id: string) => `folder-search:${id}`,
  /** One version's detail, for History's diff. */
  version: (id: string) => `version:${id}`,
  review: (id: string) => `review:${id}`,
  dropLink: (id: string, version?: number) => `drop-link:${id}:${version ?? ""}`,
} as const
