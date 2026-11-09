// Vite's `?raw` suffix imports a file's text.
declare module "*?raw" {
  const text: string
  export default text
}

// The presence client's text, bundled at build time (scripts/review-presence.ts).
declare module "virtual:review-presence" {
  const text: string
  export default text
}
