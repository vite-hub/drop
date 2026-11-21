export const consoleUrl = (path: string) =>
  `https://console.vitehub.dev/open?project=${encodeURIComponent(useRequestURL().origin)}&path=${encodeURIComponent(path)}`
