export type SideTab = "comments" | "history" | "details"

/** An app's HTML pages, index.html first, then alphabetical. */
export const appPages = (paths: string[]) =>
  paths
    .filter((path) => path.endsWith(".html"))
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))
