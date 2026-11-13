/** A page of this Drop in the ViteHub Console, where admins manage people, files and settings (server/console-authorize.ts). */
export const consoleUrl = (path: string) =>
  `https://console.vitehub.dev/open?project=${encodeURIComponent(useRequestURL().origin)}&path=${encodeURIComponent(path)}`
