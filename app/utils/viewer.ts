export const appPages = (paths: string[]) =>
  paths
    .filter((path) => path.endsWith(".html"))
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))

export const blobDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    const settle = () => {
      reader.removeEventListener("loadend", settle)
      if (reader.result === null || reader.result instanceof ArrayBuffer)
        reject(reader.error ?? new Error("Not a data URL"))
      else resolve(reader.result)
    }
    reader.addEventListener("loadend", settle)
    reader.readAsDataURL(blob)
  })
