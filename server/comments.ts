import { defineComments } from "vite-hub/comments"

/**
 * Comments that the team leaves on Drop's own pages, Figma style. The Console decides who may: a Drop admin whose
 * Console sections include `comments` (server/console-authorize.ts). Opening the Console turns the toolbar on for them;
 * everyone else gets the pages unchanged. Agents read and resolve the threads through ViteHub MCP at /_vitehub/mcp.
 */
export const comments = defineComments()
