/**
 * ViteHub's hosted Console, where admins manage users and look through what a Drop runs on. Drop serves no Console page
 * of its own: the Console calls its `POST /_vitehub/rpc` with a signature (nuxt.config `vitehub.console`).
 */
export const CONSOLE_URL = "https://console.vitehub.dev"
