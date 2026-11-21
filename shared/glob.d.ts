interface ImportMeta {
  // doctor-disable-next-line typescript/evidence/no-caller-chosen-result-type -- Vite's own declaration: the caller names what the glob holds.
  glob<T>(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, T>
}
