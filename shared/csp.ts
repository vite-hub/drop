/**
 * Drops' own pages: the Drops list and every drop's page. A drop's page shows Markdown and images, and apps and HTML
 * without a content origin, in srcdoc frames, which inherit the page's CSP, so these pages get no script policy
 * (nuxt.config.ts). Every other page does.
 */
export const DROP_PAGE_ROUTES = ["/drops", "/drops/**", "/d/**"]

/** Whether `path` is one of DROP_PAGE_ROUTES. */
export const isDropPage = (path: string) => path === "/drops" || path.startsWith("/drops/") || path.startsWith("/d/")
