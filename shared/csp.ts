export const DROP_PAGE_ROUTES = ["/drops", "/drops/**", "/d/**"]

export const isDropPage = (path: string) => path === "/drops" || path.startsWith("/drops/") || path.startsWith("/d/")
