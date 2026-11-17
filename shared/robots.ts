// Shared drops and files stay crawlable on purpose. They answer with `noindex, nofollow`
// (server/plugins/content-headers.ts), and a crawler has to fetch a page to see that header. A Disallow rule hides the
// header, so Google can still list a linked share URL, which is its own key, without a snippet. Other pages outside the
// sitemap answer noindex the same way.
export const ROBOTS_DISALLOW = ["/api/"]
