// Vite's `?raw` suffix imports a file's text.
declare module "*?raw" {
  const text: string
  export default text
}

