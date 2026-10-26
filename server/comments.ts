import { defineComments } from "vite-hub/comments"

/**
 * Comments that the team leaves on Drop's own pages, Figma style. The Console decides who may: a Drop admin whose
 * Console sections include `comments` (server/console-authorize.ts). Opening the Console turns the toolbar on for them;
 * everyone else gets the pages unchanged. Agents read and resolve the threads through ViteHub MCP at /_vitehub/mcp.
 *
 * The comments on drops are threads here too, in scopes of their own (`drop:<link>`, `site:<id>`), which the toolbar,
 * the Console, the MCP tools, and `@` suggestions don't show. Drop's routes check who may (server/utils/comments.ts).
 */
export const comments = defineComments()
