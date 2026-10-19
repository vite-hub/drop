// Vite's `import.meta.glob`, in the one form server/content.ts uses: every matching file's text, bundled at build time.
// The app gets the full declaration from vite/client; the server's tsconfig doesn't load it.
interface ImportMeta {
  // doctor-disable-next-line typescript/evidence/no-caller-chosen-result-type -- Vite's own declaration: the caller names what the glob holds.
  glob<T>(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, T>
}
