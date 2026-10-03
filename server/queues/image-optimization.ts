import { runSandbox } from "vite-hub/sandbox"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { defineQueue } from "vite-hub/queue"

export default defineQueue<string>(async ({ payload: key }) => {
  const [readError, original] = await blob.get(key)
  if (readError) throw readError
  if (!original) throw new Error("Original image is missing.")

  const response = await runSandbox("image-optimizer", { image: original })
  if (!response.ok) throw new Error(await response.text())
  const optimized = await response.blob()

  if (detectContentType(new Uint8Array(await optimized.arrayBuffer())) !== original.type)
    throw new Error("Sandbox returned an invalid image.")

  if (optimized.size < original.size) {
    const [writeError] = await blob.put(key, optimized, { access: "private", contentType: original.type })
    if (writeError) throw writeError
  }
}, { onError: error => console.error(error) })
